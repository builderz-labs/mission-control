# Implementation Plan: Image Uploads for Comments & Descriptions

## Gap Analysis Summary

**What exists:**
- Comment system in `control-center.db` with `issue_comments` table (no attachments column)
- Comment input in `TaskDetailModal` (lines 1193-1207 of task-board-panel.tsx)
- BlockEditor component with BlockNote 0.47.1 (already supports images via config)
- Button component with `icon-sm` variant
- API pattern at `/api/tasks/[id]/comments`
- `~/.openclaw/` directory exists (no `uploads/` subdirectory yet)

**What's missing:**
- `attachments` column in `issue_comments` table
- Upload API endpoints (`POST /api/uploads` and `GET /api/uploads/[filename]`)
- Comment attachment UI (file picker button, paste/drag-drop handlers, thumbnail previews)
- Comment display for images (thumbnails + lightbox)
- BlockEditor upload configuration
- Lightbox/modal component for full-size image viewing

---

## Implementation Plan

### 1. Database Migration
- [x] Add `attachments TEXT DEFAULT '[]'` column to `issue_comments` table in control-center.db
- [x] Update `CCComment` interface in `src/lib/cc-db.ts` to include `attachments?: string`
- [x] Update `mapCCComment` function to parse attachments JSON

### 2. Upload API Endpoints

#### 2.1 Create `POST /api/uploads/route.ts`
- [x] Create `src/app/api/uploads/route.ts`
- [x] Implement `POST` handler:
  - Accept `multipart/form-data` with `file` field
  - Validate file type: `image/*` (png, jpg, jpeg, gif, webp)
  - Validate size: max 10MB
  - Generate UUID filename: `{uuid}.{ext}` (lowercase extension)
  - Ensure `~/.openclaw/uploads/` directory exists (create if missing)
  - Save file to `~/.openclaw/uploads/{uuid}.{ext}`
  - Return JSON: `{ url: "/api/uploads/{uuid}.{ext}", filename: "{uuid}.{ext}" }`
- [x] Add error handling for invalid files, size limits, write errors

#### 2.2 Create `GET /api/uploads/[filename]/route.ts`
- [x] Create `src/app/api/uploads/[filename]/route.ts`
- [x] Implement `GET` handler:
  - Read file from `~/.openclaw/uploads/[filename]`
  - Set `Content-Type` based on file extension
  - Set `Cache-Control: public, max-age=31536000, immutable`
  - Return 404 if file not found
  - Return file buffer with proper headers

### 3. Lightbox Component
- [ ] Create `src/components/ui/lightbox.tsx`
- [ ] Implement simple modal overlay:
  - Dark backdrop with `backdrop-blur-sm`
  - Full-size image centered
  - Close on click outside or Escape key
  - Use existing Button component for close button (X icon)
  - Ensure dark mode compatibility

### 4. Comment Input Enhancement

#### 4.1 UI Components in TaskDetailModal (lines 1193-1207)
- [ ] Add attachment state: `const [attachments, setAttachments] = useState<Array<{url: string, filename: string, originalName?: string}>>([])`
- [ ] Add uploading state: `const [uploading, setUploading] = useState(false)`
- [ ] Replace input with flex container wrapping:
  - Text input (existing)
  - 📎 paperclip Button with `variant="ghost"`, `size="icon-sm"`
  - Hidden file input (accept="image/*", multiple)

#### 4.2 File Upload Logic
- [ ] Create `handleFileUpload` async function:
  - Accept `File[]`
  - Validate each file (type, size)
  - Set `uploading` to true
  - Upload each file to `POST /api/uploads`
  - Add result to attachments array with preview
  - Set `uploading` to false
- [ ] Wire file picker button click to trigger hidden input
- [ ] Handle file input change event → call `handleFileUpload`

#### 4.3 Paste Handler
- [ ] Add `onPaste` handler to text input:
  - Check `e.clipboardData.files`
  - If image files exist, call `handleFileUpload`
  - Prevent default if handling image

#### 4.4 Drag & Drop Handler
- [ ] Add drag event handlers to comment input container:
  - `onDragOver`: prevent default, show visual feedback
  - `onDragLeave`: remove visual feedback
  - `onDrop`: prevent default, extract files, call `handleFileUpload`

#### 4.5 Thumbnail Preview (below input, before send)
- [ ] Render attachment thumbnails below text input:
  - Horizontal row with `gap-2`, wrapping
  - Each thumbnail: 64px height, rounded corners, `object-cover`
  - X button overlay (top-right corner) to remove from attachments array
  - Show spinner during upload
- [ ] Clear attachments on successful comment submission

#### 4.6 Comment Submission
- [ ] Update `handleAddComment` to include `attachments` in POST body:
  ```json
  {
    "author": "cri",
    "content": "...",
    "attachments": [{"url": "/api/uploads/...", "filename": "..."}]
  }
  ```

### 5. Comment Display Enhancement

#### 5.1 Update Comment Rendering (renderComment function, lines 1057-1070)
- [ ] Parse `comment.attachments` (if exists)
- [ ] Render images below comment text:
  - Horizontal row with `gap-2`, wrapping
  - Thumbnails: max-height 200px, rounded corners, `object-cover`
  - Clickable → open in lightbox
- [ ] Add lightbox state: `const [lightboxImage, setLightboxImage] = useState<string | null>(null)`
- [ ] Render Lightbox component at modal level (conditionally)

### 6. BlockEditor Image Upload Configuration

#### 6.1 Update `src/components/ui/block-editor.tsx`
- [ ] Import upload helper function
- [ ] Create `uploadFile` async function:
  - Accept `File` parameter
  - Upload to `POST /api/uploads`
  - Return URL from response
- [ ] Pass `uploadFile` to `useCreateBlockNote`:
  ```typescript
  const editor = useCreateBlockNote({
    initialContent,
    uploadFile: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/uploads', { method: 'POST', body: formData })
      const data = await res.json()
      return data.url
    },
    domAttributes: { ... }
  })
  ```

### 7. Comments API Update
- [ ] Update `POST /api/tasks/[id]/comments/route.ts`:
  - Accept `attachments` field in request body
  - Store `attachments` JSON in `issue_comments.attachments` column
- [ ] Update `GET /api/tasks/[id]/comments/route.ts`:
  - Parse `attachments` JSON from DB
  - Include in response

### 8. Testing & Validation
- [ ] Test file picker → upload → preview → submit
- [ ] Test paste image → upload → preview → submit
- [ ] Test drag & drop → upload → preview → submit
- [ ] Test remove attachment before send
- [ ] Test multiple images per comment
- [ ] Test comment display with images
- [ ] Test lightbox open/close
- [ ] Test BlockEditor image paste/drop
- [ ] Test API validation (file type, size)
- [ ] Test `npx next build` passes
- [ ] Test dark mode appearance
- [ ] Test that `~/.openclaw/uploads/` is created automatically
- [ ] Verify cache headers on GET /api/uploads/[filename]

---

## Technical Notes

- **Tailwind version**: v3.4 (uses bracket syntax, e.g., `max-h-[200px]`)
- **No raw HTML elements**: Use `<Button>` component, not `<button>`
- **File storage**: `~/.openclaw/uploads/{uuid}.{ext}` (use `homedir()` from 'os' module)
- **UUID**: Use `randomUUID()` from 'crypto' module (already used in comments API)
- **Multipart parsing**: Use Next.js 15 native `request.formData()` API
- **File reading**: Use Node.js `fs.promises.readFile` for serving files
- **MIME types**: Map extensions to content-types (png→image/png, jpg→image/jpeg, etc.)
- **BlockNote version**: 0.47.1 (supports `uploadFile` config option)

---

## Dependencies Check

✅ All required dependencies exist:
- `@blocknote/core`, `@blocknote/react`, `@blocknote/mantine` (0.47.1)
- `better-sqlite3` (for DB migration)
- `crypto` (built-in, for UUID)
- `os` (built-in, for homedir)
- `fs/promises` (built-in, for file I/O)
- `Button` component exists with correct variants
- `control-center.db` schema accessible via cc-db.ts

---

## Priority Order

1. **Database migration** (blocks everything else)
2. **Upload API endpoints** (required by all upload features)
3. **Lightbox component** (needed for comment display)
4. **Comment input enhancement** (file picker, paste, drag-drop, preview)
5. **Comment display enhancement** (render thumbnails, wire lightbox)
6. **Comments API update** (persist attachments)
7. **BlockEditor configuration** (description images)
8. **Testing & validation**

---

STATUS: PLANNING_COMPLETE
