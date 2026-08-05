import sqlite3, sys
sys.stdout.reconfigure(encoding="utf-8")
db_path = r"C:\Users\MiG\AppData\Roaming\jatoaibid\workspace\yibiao.sqlite"
con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
cur = con.cursor()
cols = [d[1] for d in cur.execute("PRAGMA table_info(knowledge_documents)").fetchall()]
print("knowledge_documents cols:", cols)
rows = cur.execute("SELECT * FROM knowledge_documents ORDER BY rowid DESC LIMIT 5").fetchall()
for r in rows:
    print("---")
    for c,v in zip(cols, r):
        if c in ('title','status','message','error','source_path','file_name','progress'):
            print(f"  {c} = {str(v)[:200]}")
con.close()
