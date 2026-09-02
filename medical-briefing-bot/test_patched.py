from collector import fetch_mohw_legislation, fetch_nhis_public_notices

print("--- MOHW ---")
for a in fetch_mohw_legislation():
    print(a['title'])

print("\n--- NHIS ---")
for a in fetch_nhis_public_notices():
    print(a['source'], "|", a['title'])
