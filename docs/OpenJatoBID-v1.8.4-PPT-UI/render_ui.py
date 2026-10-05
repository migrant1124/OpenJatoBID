from pathlib import Path
from playwright.sync_api import sync_playwright
import json,base64,mimetypes
root=Path(__file__).parent
screens=[('flow','00-flow'),('management','01-management'),('update','02-update'),('prompts','03-prompts'),('templates','04-templates'),('preview','05-preview'),('workspace','06-workspace'),('skills','07-skills'),('location','08-location')]
# Render in memory. No network navigation or browser policy changes are needed.
assets={f'assets/{f.name}':'data:'+mimetypes.guess_type(str(f))[0]+';base64,'+base64.b64encode(f.read_bytes()).decode() for f in (root/'assets').iterdir() if f.is_file()}
html=(root/'prototype.html').read_text()
html=html.replace('<script>', '<script>const localAssets='+json.dumps(assets)+';function hydrate(){document.querySelectorAll("img").forEach(i=>{const p=i.getAttribute("src");if(localAssets[p])i.src=localAssets[p]})}\n',1)
html=html.replace("document.body.insertAdjacentHTML('beforeend',h)","document.body.insertAdjacentHTML('beforeend',h);hydrate()")
html=html.replace("const s=new URLSearchParams(location.search).get('screen')||'flow';", "const s=window.__screen||'flow';")
html=html.replace('</script></body>', 'hydrate();</script></body>')
results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1600,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def load_screen(s):
  global page
  viewport=page.viewport_size
  page.close();page=b.new_page(viewport=viewport);page.set_default_timeout(4000);page.on("pageerror",lambda e:errors.append(str(e)))
  markup=html.replace('<head>', '<head><script>window.__screen='+json.dumps(s)+'</script>',1)
  page.set_content(markup,wait_until='load');page.evaluate('document.fonts.ready');page.wait_for_timeout(100)
 for s,n in screens:
  load_screen(s)
  missing=page.locator('img').evaluate_all('(es)=>es.filter(e=>!e.complete||!e.naturalWidth).map(e=>e.getAttribute("src").slice(0,60))')
  page.screenshot(path=str(root/'screens'/f'{n}.png'))
  results.append({'screen':s,'viewport':'1600x1000','missing_images':missing,'js_errors':errors.copy()})
 load_screen('templates');page.locator('button.preview').first.click();assert page.locator('[role=dialog]').count()==1
 page.keyboard.press('Escape');assert page.locator('[role=dialog]').count()==0
 page.locator('input.search').fill('分屏');assert page.locator('.card:visible').count()==1
 results.append({'interaction_test':'template thumbnail modal opens; Escape closes; search filters','passed':True})
 page.set_viewport_size({'width':1366,'height':900});load_screen('prompts');page.screenshot(path=str(root/'audit/1366-prompts.png'))
 results.append({'responsive_test':'1366x900','horizontal_document_overflow':page.evaluate('document.documentElement.scrollWidth>innerWidth')})
 b.close()
(root/'audit/ui-validation.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps(results,ensure_ascii=False,indent=2))
