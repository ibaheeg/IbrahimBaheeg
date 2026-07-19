# Site Editor

A free, local, no-dependency tool for visually editing a static HTML site
(like your Weebly export) and saving changes straight back into the real
`.html` files — no rebuilding, no lost styling, because it never touches
anything except the exact bits you edit.

## How it works

- It serves your actual site folder as-is (real relative paths to CSS, fonts,
  images all just work, because they're the real files in the real place).
- Opening a page in "edit mode" doesn't rebuild it — it scans the raw HTML
  text, finds headings/paragraphs and images, and quietly tags them with
  `data-eid` attributes so the browser knows which element is which. Nothing
  else about the file changes.
- Editing a heading, swapping an image, or adding/removing a gallery image
  and hitting **Save** sends just those specific changes back to the server,
  which re-locates the exact same spot in the real file (by character
  position) and patches only that — everything else in the file, byte for
  byte, stays untouched.

## Requirements

Just Node.js (no `npm install`, no other dependencies). If you don't have
Node installed: https://nodejs.org (LTS version is fine).

## Run it

```
node server.js /path/to/your/site/folder
```

(If you don't pass a path, it uses the current folder. You can also pass a
port as a second argument — default is 5051.)

Then open:

```
http://localhost:5051/__editor__/
```

Pick a page on the left. It loads for real, with all its real CSS/fonts/
images. Click any heading or paragraph to edit it directly. Click any image
to swap it (pick a file from your computer — it gets copied into an
`uploads/` folder in your site and the `src` updated). Hover a gallery image
to remove it, or click the **+** at the end of a gallery to add one.

Hit **Save** (bottom-right) when you're happy. It writes straight to the
`.html` file on disk. Since it's your real git repo, you can `git diff`
afterward and see a small, exact, targeted change — then commit and push to
GitHub as usual.

## Known limitations

- It only recognizes `<h1>`–`<h6>` and `<p>` as editable text, and only when
  they contain plain text (no nested tags inside them) — this keeps it safe
  from ever mangling more complex markup. Anything else isn't editable
  through this tool; edit the HTML file directly for those spots.
- Galleries are detected as any element whose direct children are 2+ images,
  or 2+ single-image wrappers (like `<figure><img></figure>`). Other gallery
  markup patterns won't be picked up automatically.
- No reordering UI yet (add/remove only). Removing the last remaining image
  in a gallery is blocked, since it usually breaks the layout.
- No authentication — this is meant to run on your own machine while you
  work, not to be exposed on the internet.
