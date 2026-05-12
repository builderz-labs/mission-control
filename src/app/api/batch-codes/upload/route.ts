import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

// PDF parsing
async function parseDeliveryNotePDF(buffer: Buffer): Promise<any[]> {
  const pdfParse = require('pdf-parse')
  const data = await pdfParse(buffer)
  const text = data.text
  
  // Extract lines that look like delivery note rows
  // Format: Product Code | Description | Batch Code | Expiry Date
  const lines = text.split('\n')
  const batches: any[] = []
  
  // Skip header rows - look for data rows with pattern
  for (const line of lines) {
    // Skip empty or header-like lines
    if (!line.trim() || line.toLowerCase().includes('product') && line.toLowerCase().includes('description')) {
      continue
    }
    
    // Try to extract fields from line - assume pipe or space separated
    const parts = line.trim().split(/\s{2,}|\|/).map((p: string) => p.trim()).filter(Boolean)
    
    if (parts.length >= 4) {
      const productCode = parts[0]
      const productDescription = parts[1]
      const batchCode = parts[2]
      const expiryDateStr = parts[3]
      
      // Validate batch code looks like a batch (alphanumeric)
      if (batchCode && /^[A-Za-z0-9\-]+$/.test(batchCode) && productCode) {
        // Parse expiry date (could be DD/MM/YYYY or YYYY-MM-DD)
        let expiryDate = expiryDateStr
        try {
          const dateParts = expiryDateStr.split(/[-/]/)
          if (dateParts.length === 3) {
            const day = parseInt(dateParts[0])
            const month = parseInt(dateParts[1])
            const year = parseInt(dateParts[2])
            // Assume YYYY if year > 100, otherwise DD/MM/YY or DD/MM/YYYY
            const fullYear = year < 100 ? 2000 + year : year
            expiryDate = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          }
        } catch (e) {
          // Use as-is if parsing fails
        }
        
        batches.push({
          product_code: productCode,
          product_description: productDescription,
          batch_code: batchCode,
          expiry_date: expiryDate
        })
      }
    }
  }
  
  return batches
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  
  // Validate it's a PDF
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Only PDF files are accepted' }, { status: 400 })
  }
  
  // Read file buffer
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  
  // Parse PDF
  let batches: any[]
  try {
    batches = await parseDeliveryNotePDF(buffer)
  } catch (error) {
    console.error('PDF parsing error:', error)
    return NextResponse.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
  
  if (batches.length === 0) {
    return NextResponse.json({ error: 'No valid batch data found in PDF' }, { status: 400 })
  }
  
  // Save to database
  const db = getDatabase()
  const deliveryDate = new Date().toISOString().split('T')[0]
  
  const insertedIds: string[] = []
  
  for (const batch of batches) {
    const id = `${batch.batch_code}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    db.prepare(`
      INSERT INTO batch_codes (id, product_code, product_description, batch_code, expiry_date, status, delivery_note, delivery_date)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      batch.product_code,
      batch.product_description,
      batch.batch_code,
      batch.expiry_date,
      file.name,
      deliveryDate
    )
    
    insertedIds.push(id)
  }
  
  return NextResponse.json({ 
    success: true, 
    count: insertedIds.length,
    batches: insertedIds
  })
}