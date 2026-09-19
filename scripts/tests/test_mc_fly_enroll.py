import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('enroll', pathlib.Path(__file__).parents[1] / 'mc-fly-enroll.py')
enroll = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enroll)


class EnrollmentTests(unittest.TestCase):
    def test_read_retry_does_not_expose_error_output(self):
        failure = subprocess.CalledProcessError(1, ['gh'], stderr='secret')
        with patch.object(enroll.subprocess, 'run', side_effect=[failure, subprocess.CompletedProcess([], 0, 'ok')]) as run:
            with patch.object(enroll.time, 'sleep'):
                self.assertEqual(enroll.command(['gh', 'api']), 'ok')
            self.assertEqual(run.call_count, 2)
        with patch.object(enroll.subprocess, 'run', side_effect=failure):
            with self.assertRaisesRegex(RuntimeError, 'withheld') as error:
                enroll.command(['gh'], attempts=1)
            self.assertNotIn('secret', str(error.exception))

    def test_unknown_create_reuses_observed_read_only_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            repo = 'owner/repo'
            key = root / 'mc-fly-repository-keys' / enroll.hashlib.sha256(repo.encode()).hexdigest()[:24]
            key.parent.mkdir()
            key.write_text('private')
            key.with_suffix('.pub').write_text('ssh-ed25519 public comment')
            match = {'key': 'ssh-ed25519 public', 'read_only': True, 'id': 1}
            registry = {}
            with patch.object(enroll, 'STATE', root), patch.object(enroll, 'github', side_effect=[[], RuntimeError('lost'), [match]]):
                result = enroll.enroll_key(repo, 'hosts', registry)
            self.assertTrue(result['read_only'])
            self.assertEqual(registry['https://github.com/owner/repo.git']['private_key'], 'private')
            self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            match['read_only'] = False
            with patch.object(enroll, 'STATE', root), patch.object(enroll, 'github', return_value=[match]):
                with self.assertRaisesRegex(RuntimeError, 'not read-only'):
                    enroll.enroll_key(repo, 'hosts', registry)

    def test_secret_upload_uses_private_file_and_removes_it_even_on_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            def upload(args, **kwargs):
                self.assertNotIn('DOPPLER_TOKEN', kwargs['env'])
                self.assertNotIn('private', args)
                target = pathlib.Path(args[3])
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                raise RuntimeError('upload failed')
            with patch.object(enroll, 'STATE', root), patch.object(enroll, 'command', side_effect=upload):
                with self.assertRaisesRegex(RuntimeError, 'upload failed'):
                    enroll.save_config({'key': 'private'}, {'DOPPLER_TOKEN': 'readonly'})
            self.assertEqual(list(root.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
