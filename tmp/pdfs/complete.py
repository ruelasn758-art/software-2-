from pathlib import Path
from io import BytesIO
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pypdf import PdfReader,PdfWriter
root=Path.cwd()
out=root/'output/pdf/tercera_tarea_completada.pdf'
out.parent.mkdir(parents=True,exist_ok=True)
src=PdfReader(r'C:\Users\ademi\OneDrive\Documentos\basico 7\tareas\tercera tarea.pdf')
# Positions are measured on the 1800-pixel-high page previews.
answers=[[
(390,570,'her hands'),(398,602,'our hands'),(955,536,'his hands'),(986,570,'their hands'),(1000,602,'your hands'),
(348,804,'their'),(217,838,'live with our'),(280,871,'with her parents'),(771,771,'live with my'),(804,804,'lives with his parents'),(893,838,'with your parents'),(919,871,'live with their parents'),
(998,1070,'their'),(884,1104,'his'),(927,1138,'his'),(892,1172,'her'),(1009,1206,'their'),(890,1240,'her'),(1061,1274,'their'),
(650,1537,'his'),(650,1575,'Their'),(849,1610,'our'),(459,1648,'her')
],[
(402,201,'my'),(283,238,'your'),(668,275,'her'),(703,312,'their'),(432,349,'my'),(515,386,'Its'),(612,422,'His'),(971,422,'his'),
(622,675,'my key'),(410,711,'Her husband'),(521,748,'your coat'),(797,785,'their homework'),(822,821,'his name'),(518,858,'Our house'),
(344,1052,'mine'),(341,1085,'ours'),(481,1118,'hers'),(971,1018,'theirs'),(1080,1052,'yours'),(1068,1085,'mine'),(940,1118,'his'),
(599,1358,'of hers'),(564,1398,'friends of ours'),(487,1439,'friend of mine'),(528,1478,'friend of his'),(721,1518,'friends of yours')
],[
(707,274,'Whose'),(707,308,'camera'),(1008,288,'hers'),
(144,510,'Whose gloves'),(144,544,'are'),(480,518,'are mine.'),
(708,515,'Whose hat'),(708,548,'is this'),(970,526,"It's his."),
(145,767,'Whose money'),(145,799,'is this'),(414,773,"It's yours."),
(708,767,'Whose books'),(708,800,'are these'),(965,774,"They're ours."),
(520,1099,'him at his'),(530,1137,'them at their'),(344,1174,'to stay with me at my house.'),(344,1211,'to stay with her at her house.'),(398,1248,'to stay with you at your house'),
(746,1417,'them'),(784,1463,'him'),(773,1507,'our'),(652,1552,'yours'),(1035,1598,'us'),(467,1642,'her')
]]
w=PdfWriter()
for i,p in enumerate(src.pages):
 b=BytesIO(); c=canvas.Canvas(b,pagesize=(float(p.mediabox.width),float(p.mediabox.height)))
 scale=float(p.mediabox.height)/1800
 c.setFillColor(HexColor('#0753a6'))
 for row in answers[i]:
  x,y,t,*size=row
  c.setFont('Helvetica-Bold',(size[0] if size else 24)*scale)
  c.drawString(x*scale,(1800-y)*scale,t)
 c.save();p.merge_page(PdfReader(b).pages[0]);w.add_page(p)
with out.open('wb') as f:w.write(f)
check=PdfReader(out)
assert len(check.pages)==3
print(out)

