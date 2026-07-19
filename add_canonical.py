import os

BASE_URL = "https://ibaheeg.github.io"
ROOT_DIR = "."  # run this from your repo root

for dirpath, _, filenames in os.walk(ROOT_DIR):
    for fname in filenames:
        if not fname.endswith(".html"):
            continue
        filepath = os.path.join(dirpath, fname)

        # Build the canonical URL from the file path
        rel_path = os.path.relpath(filepath, ROOT_DIR).replace("\\", "/")
        if rel_path == "index.html":
            url = BASE_URL + "/"
        elif rel_path.endswith("/index.html"):
            url = f"{BASE_URL}/{rel_path[:-len('index.html')]}"
        else:
            url = f"{BASE_URL}/{rel_path}"

        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        if 'rel="canonical"' in content:
            print(f"Skipped (already has canonical): {filepath}")
            continue

        tag = f'  <link rel="canonical" href="{url}" />\n'
        if "</head>" in content:
            content = content.replace("</head>", tag + "</head>", 1)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Added canonical to: {filepath} -> {url}")
        else:
            print(f"WARNING: no </head> found in {filepath}")