'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface CreateFileModalProps {
  onClose: () => void
  onCreate: (path: string, content: string) => void
}

const FILE_TEMPLATES: Record<string, string> = {
  md: '# New Document\n\n',
  json: '{\n  \n}',
  txt: '',
  log: '',
}

export function CreateFileModal({ onClose, onCreate }: CreateFileModalProps) {
  const t = useTranslations('memoryBrowser')
  const [fileName, setFileName] = useState('')
  const [filePath, setFilePath] = useState('knowledge/')
  const [initialContent, setInitialContent] = useState('')
  const [fileType, setFileType] = useState('md')

  const handleCreate = () => {
    if (!fileName.trim()) return
    onCreate(filePath + fileName + '.' + fileType, initialContent)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[hsl(var(--surface-1))] border border-border rounded-lg max-w-md w-full p-5 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-foreground font-mono">{t('newFileTitle')}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">x</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">{t('directory')}</label>
            <select value={filePath} onChange={(e) => setFilePath(e.target.value)} className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30">
              <option value="knowledge-base/">knowledge-base/</option>
              <option value="memory/">memory/</option>
              <option value="knowledge/">knowledge/</option>
              <option value="daily/">daily/</option>
              <option value="logs/">logs/</option>
              <option value="">root/</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">{t('fileName')}</label>
            <input type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="my-file" className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30" autoFocus />
          </div>
          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">{t('fileType')}</label>
            <select value={fileType} onChange={(e) => { setFileType(e.target.value); setInitialContent(FILE_TEMPLATES[e.target.value] || '') }} className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30">
              <option value="md">.md</option>
              <option value="json">.json</option>
              <option value="txt">.txt</option>
              <option value="log">.log</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">{t('content')}</label>
            <textarea value={initialContent} onChange={(e) => setInitialContent(e.target.value)} className="w-full h-20 px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30 resize-none" placeholder={t('contentOptional')} />
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/40 bg-[hsl(var(--surface-0))] px-2 py-1 rounded">{filePath}{fileName || '...'}.{fileType}</div>
          <div className="flex gap-2 pt-2">
            <Button onClick={handleCreate} disabled={!fileName.trim()} size="sm" className="flex-1">{t('create')}</Button>
            <Button onClick={onClose} variant="secondary" size="sm">{t('cancel')}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface DeleteConfirmModalProps {
  fileName: string
  onClose: () => void
  onConfirm: () => void
}

export function DeleteConfirmModal({ fileName, onClose, onConfirm }: DeleteConfirmModalProps) {
  const t = useTranslations('memoryBrowser')
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[hsl(var(--surface-1))] border border-border rounded-lg max-w-sm w-full p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-red-400 font-mono mb-3">{t('deleteFileTitle')}</h3>
        <div className="bg-red-500/5 border border-red-500/15 rounded-md p-3 mb-4">
          <p className="text-xs text-muted-foreground font-mono">{t('permanentlyDelete')}</p>
          <p className="text-xs font-mono text-foreground mt-1 bg-[hsl(var(--surface-0))] px-2 py-1 rounded">{fileName}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onConfirm} variant="destructive" size="sm" className="flex-1">{t('delete')}</Button>
          <Button onClick={onClose} variant="secondary" size="sm">{t('cancel')}</Button>
        </div>
      </div>
    </div>
  )
}
