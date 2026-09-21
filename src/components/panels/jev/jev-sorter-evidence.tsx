import type { JevPolicy } from './jev-ui-types'
import type { useJevSorter } from './use-jev-sorter'

export function JevSorterEvidence({ policy, data, canRun }: {
  policy: JevPolicy; data: ReturnType<typeof useJevSorter>; canRun: boolean
}) {
  const disabled = data.running || data.busy || !canRun
  return <details className="jev-sorter-evidence" open={data.items.length === 0 ? true : undefined}>
    <summary>Add or review dataset</summary>
    <div className="jev-sorter-evidence-body">
      <p>Paste one item, or a JSON array of up to 100 items. Identical items are counted once. Nothing is sent to Jev until you press Run.</p>
      <div className="jev-sorter-actions">
        <label>Context format<select aria-label="Context format" value={data.format} disabled={disabled} onChange={(event) => data.changeFormat(event.target.value as typeof data.format)}>
          <option value="text">Plain text · one item</option><option value="json">Structured JSON · one item</option><option value="dataset">JSON array · one item per row</option>
        </select></label>
        {policy.configuration?.contextMode !== 'pasted' && <button type="button" disabled={disabled} onClick={() => void data.loadContext()}>{data.busy ? 'Preparing…' : 'Load repository context'}</button>}
      </div>
      <label>Context Jev will evaluate<textarea maxLength={200000} disabled={disabled} value={data.text} onChange={(event) => data.edit(event.target.value)} placeholder={'Describe the evidence, or paste [{"text":"First item"},{"text":"Second item"}]…'} /></label>
      <div className="jev-sorter-actions">
        <button type="button" disabled={disabled || !data.text.trim()} onClick={() => void data.prepare()}>Prepare dataset</button>
        {policy.configuration ? <p>History preview: {policy.configuration.retainPreview ? 'up to 500 redacted characters' : 'off'}, as approved.</p>
          : <label className="jev-sorter-check"><input type="checkbox" checked={data.retain} disabled={disabled} onChange={(event) => data.setRetain(event.target.checked)} />Keep a redacted preview in history (optional)</label>}
      </div>
      <p className="jev-sorter-muted">Raw input stays in this tab and is cleared when you leave this setup. Re-paste it to run again after reopening. Results use existing Mission Control storage and configured cloud sync.</p>
    </div>
  </details>
}
