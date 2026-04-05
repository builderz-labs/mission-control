'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('CreateAgentModal')

interface CreateAgentModalProps {
  onClose: () => void
  onCreated: () => void
}

interface CreateFormData {
  name: string
  role: string
  session_key: string
  soul_content: string
}

const EMPTY_FORM: CreateFormData = {
  name: '',
  role: '',
  session_key: '',
  soul_content: '',
}

export function CreateAgentModal({ onClose, onCreated }: CreateAgentModalProps): React.JSX.Element {
  const t = useTranslations('agentSquad')
  const [formData, setFormData] = useState<CreateFormData>(EMPTY_FORM)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(t('failedToCreate'))
      onCreated()
      onClose()
    } catch (error) {
      log.error('Error creating agent:', error)
    }
  }

  const inputClass = 'w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full">
        <form onSubmit={(e) => void handleSubmit(e)} className="p-6">
          <h3 className="text-xl font-bold text-white mb-4">{t('createNewAgent')}</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('name')}</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('role')}</label>
              <input
                type="text"
                value={formData.role}
                onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                className={inputClass}
                placeholder={t('rolePlaceholder')}
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('sessionKeyOptional')}</label>
              <input
                type="text"
                value={formData.session_key}
                onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                className={inputClass}
                placeholder={t('sessionKeyPlaceholder')}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('soulContentOptional')}</label>
              <textarea
                value={formData.soul_content}
                onChange={(e) => setFormData(prev => ({ ...prev, soul_content: e.target.value }))}
                className={inputClass}
                rows={3}
                placeholder={t('soulPlaceholder')}
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button type="submit" className="flex-1">{t('createAgent')}</Button>
            <Button type="button" onClick={onClose} variant="secondary" className="flex-1">{t('cancel')}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
