from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
r=Path(__file__).parent/'assets'
fpath='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
bpath='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
def font(n,b=False):return ImageFont.truetype(bpath if b else fpath,n)
# These are explicitly labelled UI-only illustration fixtures, not fetched source images.
for i in range(6):
 im=Image.new('RGB',(720,450),[(232,239,233),(240,233,219),(227,237,249),(238,227,237),(227,234,233),(231,237,246)][i]);d=ImageDraw.Draw(im)
 if i%3==0:
  d.ellipse((340,10,740,410),fill=(204,219,206));d.ellipse((418,359,650,400),fill=(180,197,185));d.rounded_rectangle((470,134,573,367),13,fill=(250,249,244));d.rounded_rectangle((491,102,552,155),8,fill=(50,70,62));title='自然 / 材质';sub='产品与空间的柔和对话'
 elif i%3==1:
  d.ellipse((338,-90,855,425),outline=(188,159,114),width=3);d.polygon([(400,340),(530,267),(679,343),(550,418)],fill=(102,129,137));d.polygon([(400,340),(400,174),(530,101),(530,267)],fill=(74,97,108));d.polygon([(530,101),(679,176),(679,343),(530,267)],fill=(154,179,181));title='构成 / 秩序';sub='几何形体与光影表达'
 else:
  for j in range(3):
   x=370+j*80;y=130+j*55;d.rounded_rectangle((x,y,x+134,y+110),6,fill=[(37,93,154),(83,130,180),(151,184,211)][j]);d.line((x+18,y+28,x+106,y+28),fill='white',width=3)
  title='信息 / 有序';sub='清晰传达每一层关系'
 d.text((35,80),title,font=font(44,True),fill=(44,62,77));d.text((38,145),sub,font=font(21),fill=(99,114,127));d.text((38,410),'UI 参考图示例',font=font(15),fill=(129,140,149));im.save(r/f'prompt-{i+1}.jpg',quality=92)
for i,title in enumerate(['年度工作汇报','项目实施方案','服务流程','关键数据','培训交流']):
 im=Image.new('RGB',(960,540),'#f8fafc');d=ImageDraw.Draw(im)
 if i in [0,1,4]:
  c=[(33,62,99),(45,96,119),(32,79,106),(47,101,146),(53,89,87)][i]
  d.polygon([(610,0),(960,0),(960,540),(455,540)],fill=c);d.polygon([(790,0),(960,0),(960,540),(640,540)],fill=tuple(v+22 for v in c));d.rectangle((64,132,132,139),fill=c);d.text((60,180),title,font=font(61,True),fill='#203c61');d.text((65,279),'内部展示 · 内容与设计示例',font=font(24),fill='#8090a6')
 elif i==2:
  d.text((48,42),title,font=font(43,True),fill='#203c61');d.line((48,113,912,113),fill='#d7e0eb',width=2)
  for n,t in enumerate(['需求对接','方案设计','生产执行','验收交付']):
   x=60+n*224;d.rounded_rectangle((x,210,x+171,365),6,fill='#e6f0fb');d.text((x+20,220),f'0{n+1}',font=font(40,True),fill='#1677ff');d.text((x+20,305),t,font=font(25),fill='#304d74')
   if n<3:d.line((x+181,286,x+210,286),fill='#96b8df',width=3)
 else:
  d.text((48,42),title,font=font(43,True),fill='#203c61')
  for n,h in enumerate([87,135,191,231]):
   x=86+n*195;d.rectangle((x,403-h,x+88,403),fill='#1677ff');d.text((x-2,417),f'第{n+1}季度',font=font(22),fill='#657b98')
 d.text((49,502),'UI 布局示例 · 非上游模板实测结果',font=font(15),fill='#96a3b4');im.save(r/f'deck-{i+1}.png')
print('UI fixture assets created (labelled)')
