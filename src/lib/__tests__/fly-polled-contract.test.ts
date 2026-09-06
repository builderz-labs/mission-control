// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { readPolledResult } from '../fly-polled-result'

describe('actual worker / controller contract', () => {
  it('accepts both states from a real isolated Git checkout and package test', () => {
    const output = execFileSync(process.execPath,['--input-type=module','-e',`
      import { executeJob } from './workers/polled.mjs';
      import { job,fixture,fixtureRunner } from './workers/tests/helpers.mjs';
      const source=await fixture(); const states=[];
      await executeJob(job({base_sha:source.sha,checks:['test']}),{
        cwd:source.checkout,run:fixtureRunner(source),
        write:async state=>states.push({...state,updated_at:Math.floor(Date.now()/1000)})
      }); process.stdout.write(JSON.stringify(states));
    `],{cwd:process.cwd(),timeout:30000,encoding:'utf8'})
    const states = JSON.parse(output) as Array<{ job_id: string; branch_name: string; state: string }>
    const identity = {id:states[0].job_id,branch_name:states[0].branch_name}
    expect(states.map(state=>readPolledResult(JSON.stringify(state),identity).state)).toEqual(['running','succeeded'])
    expect(() => readPolledResult(JSON.stringify(states[1]),{...identity,branch_name:'different'})).toThrow('identity mismatch')
  })
})

