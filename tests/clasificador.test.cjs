const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function preparar(){
  const eventos={};
  const elemento=()=>({value:'',textContent:'',hidden:false,dataset:{},
    classList:{toggle(){},remove(){}},addEventListener(n,f){this[n]=f;},focus(){},scrollIntoView(){}});
  const ids=Object.fromEntries(['foto-analisis','cambiar-categoria','categoria_id','reintentar-analisis','cat-grid','area-hint'].map(id=>[id,elemento()]));
  const botones=['Bache','Basura','Luminaria','Fuga'].map((categoria,i)=>Object.assign(elemento(),{dataset:{id:String(i+1),categoria,area:'Área de prueba'}}));
  class Worker {
    postMessage(data){this.ultimo=data;}
    terminate(){this.cerrado=true;}
    responder(categoria,id=this.ultimo.id){this.onmessage({data:{id,tipo:'resultado',categoria}});}
  }
  const context=vm.createContext({
    window:{addEventListener(n,f){eventos[n]=f;}},
    document:{getElementById:id=>ids[id],querySelectorAll:()=>botones,querySelector:()=>elemento(),addEventListener(n,f){eventos[n]=f;}},
    Worker,setTimeout:()=>1,clearTimeout(){},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js/foto-clasificador.js'),'utf8'),context);
  const clasificador=new context.window.ClasificadorFoto();
  return {clasificador,ids,eventos};
}
test('La sugerencia selecciona una categoría editable',()=>{
  const {clasificador:c,ids}=preparar();c.analizar('foto');c.worker.responder('Basura');
  assert.equal(ids.categoria_id.value,'2');
  assert.match(ids['foto-analisis'].textContent,/Posible incidencia detectada: Basura/);
  assert.equal(ids['cambiar-categoria'].hidden,false);
});
test('Una respuesta tardía no sobrescribe la elección manual',()=>{
  const {clasificador:c,ids,eventos}=preparar();c.analizar('foto');
  ids.categoria_id.value='1';eventos['categoria-manual']();
  c.worker.responder('Basura');assert.equal(ids.categoria_id.value,'1');
});
test('Se descartan resultados de una foto reemplazada',()=>{
  const {clasificador:c,ids}=preparar();c.analizar('foto antigua');
  const viejo=c.worker.ultimo.id;c.cancelar();c.analizar('foto nueva');
  c.worker.responder('Luminaria',viejo);assert.equal(ids.categoria_id.value,'');
  c.worker.responder('Fuga');assert.equal(ids.categoria_id.value,'4');
});
test('La abstención permite elegir manualmente',()=>{
  const {clasificador:c,ids}=preparar();c.analizar('foto ambigua');c.worker.responder(null);
  assert.equal(ids.categoria_id.value,'');assert.match(ids['foto-analisis'].textContent,/No pude identificar/);
});
test('Un error permite reintentar sin asignar una categoría inventada',()=>{
  const {clasificador:c,ids}=preparar();c.analizar('foto');c.worker.onerror();
  assert.equal(ids.categoria_id.value,'');assert.equal(ids['reintentar-analisis'].hidden,false);
  ids['reintentar-analisis'].click();c.worker.responder('Bache');assert.equal(ids.categoria_id.value,'1');
});
