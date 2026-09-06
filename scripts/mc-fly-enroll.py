#!/usr/bin/env python3
"""Enroll GitHub projects in the shared Fly pool with repository-only deploy keys."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

STATE = Path.home() / '.agents/state'
TITLE = 'mission-control-fly-readonly-20260906'


def command(args, payload=None, env=None, attempts=2):
    for attempt in range(attempts):
        try:
            result = subprocess.run(args, input=payload, text=True, capture_output=True,
                                    timeout=60, env=env, check=True)
            return result.stdout
        except (subprocess.SubprocessError, OSError):
            if attempt + 1 == attempts:
                raise RuntimeError(f'{args[0]} operation failed; credentials/output withheld') from None
            time.sleep(1)


def github(endpoint, payload=None):
    args = ['gh', 'api', endpoint]
    if payload is not None:
        args += ['--method', 'POST', '--input', '-']
    return json.loads(command(args, json.dumps(payload) if payload is not None else None,
                              attempts=1 if payload is not None else 2))


def matches(keys, public):
    return next((key for key in keys if key['key'].split()[:2] == public.split()[:2]), None)


def enroll_key(repository, known_hosts, registry):
    endpoint = f'repos/{repository}/keys'
    url = f'https://github.com/{repository}.git'
    directory = STATE / 'mc-fly-repository-keys'
    directory.mkdir(mode=0o700, exist_ok=True)
    key = directory / hashlib.sha256(repository.encode()).hexdigest()[:24]
    if not key.exists():
        command(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', TITLE, '-f', str(key)], attempts=1)
    key.chmod(0o600)
    public = key.with_suffix('.pub').read_text().strip()
    # Reuse the already commissioned single-repository key on migration.
    legacy = STATE / 'mc-stillpoint-readonly-deploy-key'
    if repository == 'tylerdevries22-afk/stillpoint-builders' and legacy.exists():
        key = legacy
        public = legacy.with_suffix('.pub').read_text().strip()
    existing = matches(github(endpoint), public)
    if not existing:
        try:
            existing = github(endpoint, {'title': TITLE, 'key': public, 'read_only': True})
        except RuntimeError:
            existing = matches(github(endpoint), public)
            if not existing:
                raise
    if existing['read_only'] is not True:
        raise RuntimeError('Existing deploy key is not read-only; refusing reuse')
    registry[url] = {'private_key': key.read_text(), 'known_hosts': known_hosts}
    return {'repository': repository, 'key_id': existing['id'], 'read_only': True}


def save_config(values, env):
    fd, name = tempfile.mkstemp(prefix='mc-fly-enrollment-', suffix='.json', dir=STATE)
    try:
        with os.fdopen(fd, 'w') as file:
            json.dump(values, file)
        writer = env.copy()
        writer.pop('DOPPLER_TOKEN', None)
        command(['doppler', 'secrets', 'upload', name, '--project', 'mission-control',
                 '--config', 'prd', '--silent'], env=writer)
    finally:
        Path(name).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--owner')
    group.add_argument('--repository', action='append')
    args = parser.parse_args()
    if args.owner and not re.fullmatch(r'[A-Za-z0-9-]+', args.owner):
        raise RuntimeError('Invalid GitHub owner')
    env = os.environ.copy()
    env['DOPPLER_TOKEN'] = (STATE / 'mission-control-doppler-service-token').read_text().strip()
    config = json.loads(command(['doppler', 'secrets', 'download', '--no-file', '--format',
                                 'json', '--project', 'mission-control', '--config', 'prd'], env=env))
    registry = json.loads(config.get('MC_FLY_GIT_SSH_KEYS_JSON') or '{}')
    allowed = set(filter(None, config.get('MC_FLY_ALLOWED_REPOS', '').split(',')))
    private = set(filter(None, config.get('MC_FLY_PRIVATE_REPOS', '').split(',')))
    if args.owner:
        repos = json.loads(command(['gh', 'repo', 'list', args.owner, '--limit', '1000',
                                     '--json', 'nameWithOwner,isPrivate,isArchived']))
        if len(repos) >= 1000:
            raise RuntimeError('Repository inventory may be truncated; enroll explicit repositories')
    else:
        repos = []
        for name in args.repository:
            if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', name):
                raise RuntimeError('Invalid repository')
            value = github(f'repos/{name}')
            repos.append({'nameWithOwner': value['full_name'], 'isPrivate': value['private'],
                          'isArchived': value['archived']})
    hosts = '\n'.join('github.com ' + key for key in github('meta')['ssh_keys']) + '\n'
    evidence = []
    for repo in repos:
        if repo['isArchived']:
            continue
        name = repo['nameWithOwner']
        url = f'https://github.com/{name}.git'
        allowed.add(url)
        if repo['isPrivate']:
            private.add(url)
            evidence.append(enroll_key(name, hosts, registry))
        else:
            evidence.append({'repository': name, 'public': True})
        # Checkpoint each successful enrollment so a later failure is resumable.
        save_config({'MC_FLY_GIT_SSH_KEYS_JSON': json.dumps(registry),
                     'MC_FLY_ALLOWED_REPOS': ','.join(sorted(allowed)),
                     'MC_FLY_PRIVATE_REPOS': ','.join(sorted(private))}, env)
        print(json.dumps(evidence[-1]), flush=True)
    (STATE / 'mc-fly-enrollment-evidence.json').write_text(json.dumps(evidence, indent=2))
    print('Enrollment saved. Apply controller configuration during an idle window; agent restarts are unnecessary.')


if __name__ == '__main__':
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'mc-fly-enrollment.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            main()
        except RuntimeError as error:
            raise SystemExit(str(error)) from None
