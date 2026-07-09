# ageaf-next

This fork starts from `OniReimu/Ageaf` and is maintained as a practical Overleaf agent for Joe's workflow.

Initial local goals:

- Keep the Chrome extension and host setup reproducible.
- Prefer applyable review cards over copy/paste-only responses.
- Make host/runtime failures visible and recoverable.
- Keep upstream history intact while allowing local product fixes.

First fork fix:

- `insertAtCursor` suggestions now render as review cards with accept/reject controls instead of plain copy-only code blocks.
