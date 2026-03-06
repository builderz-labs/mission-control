# Image Uploads — Comments & Descriptions

## Overview
Add image upload support for task comments and descriptions. Users can paste, drag-drop, or click to attach images. Images stored locally, served via API.

## Storage

- **Directory:** `~/.openclaw/uploads/` (create if missing)
- **Filename:** `{uuid}.{ext}` (preserve original extension, normalize to lowercase)
- **Accepted formats:** png, jpg, jpeg, gif, webp
- **Max size:** 10MB per file
- **Serve via:** `GET /api/uploads/[filename]` with proper `Content-Type` and cache headers

## API Endpoints

### `POST /api/uploads`
- Accept: `multipart/form-data` with field `file`
- Validate: file type (image/*), size (<10MB)
- Save to `~/.openclaw/uploads/{uuid}.{ext}`
- Return: `{ url: "/api/uploads/{uuid}.{ext}", filename: "{uuid}.{ext}" }`

### `GET /api/uploads/[filename]`
- Serve the file from `~/.openclaw/uploads/`
- Set `Content-Type` based on extension
- Set `Cache-Control: public, max-age=31536000, immutable` (files are UUID-named, never change)
- 404 if not found

## Comment Images

### DB Change
Add `attachments` column to `issue_comments`:
```sql
ALTER TABLE issue_comments ADD COLUMN attachments TEXT DEFAULT '[]';
```
- JSON array of `{ url: string, filename: string, originalName?: string }`

### Comment Input UI
- Add a 📎 (paperclip) icon button next to the send button in the comment input area
- Clicking it opens a file picker (accept="image/*")
- **Paste support:** Cmd+V with image in clipboard → auto-upload, show preview
- **Drag & drop:** drag image onto the comment input area → auto-upload, show preview
- While uploading: show a small thumbnail with a spinner/progress indicator
- Multiple images allowed per comment
- Uploaded images shown as small thumbnails (64px height) below the text input, with an X to remove before sending
- On submit: include attachment URLs in the comment data

### Comment Display
- Images render below the comment text as thumbnails (max-height 200px, rounded corners)
- Click thumbnail → open full-size in a lightbox/modal (simple overlay with the full image + click-outside-to-close)
- Multiple images: horizontal row with gap-2, wrapping

## Description Images (BlockEditor)

BlockNote already supports image blocks. We need to:
- Configure the BlockEditor's upload handler to use our `POST /api/uploads` endpoint
- When a user pastes/drops an image into the editor, it should upload and insert an image block
- This may already work if BlockNote has an `uploadFile` config option — check the BlockNote docs

## Technical Notes
- Comment input is in `task-board-panel.tsx` inside `TaskDetailModal`
- Use `<Button>` for the attachment button (variant="ghost", size="icon-sm")
- Preview thumbnails: use `<img>` with `object-cover` and rounded corners
- Lightbox: simple modal with backdrop blur, full-size image, close on click/escape
- **Tailwind v3.4** — bracket syntax
- Use existing `<Button>` component, no raw HTML buttons

## Acceptance Criteria
- [ ] Build passes (`npx next build`)
- [ ] `POST /api/uploads` accepts images, validates type/size, returns URL
- [ ] `GET /api/uploads/[filename]` serves images with correct content-type and caching
- [ ] `~/.openclaw/uploads/` directory created automatically
- [ ] Comment input has 📎 button that opens file picker
- [ ] Cmd+V paste of clipboard image uploads and shows preview
- [ ] Drag & drop image onto comment area works
- [ ] Upload shows progress/spinner
- [ ] Thumbnails shown below input before sending, removable with X
- [ ] Submitted comment displays images as clickable thumbnails
- [ ] Click thumbnail opens lightbox with full image
- [ ] `attachments` column added to `issue_comments`
- [ ] BlockEditor configured to upload images via `/api/uploads`
- [ ] Dark mode correct
- [ ] No raw HTML elements — use project components
