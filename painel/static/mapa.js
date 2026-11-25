const ctx = document.querySelector('canvas').getContext('2d');
const routeA = [[130,364],[221,364],[221,244],[221,160],[374,160],[521,160],[660,160],[744,160],[744,244]];
const routeB = [[130,364],[221,364],[374,364],[521,364],[660,364],[744,364],[744,244]];
const aSegment = [[374,160],[521,160]];
const bSegment = [[374,364],[521,364]];
const blue = '#1662e9';
const red = '#c52232';

function line(points, color, width, dashed = false) {
  ctx.beginPath();
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [8,6] : []);
  points.forEach(([x,y],i) => i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y));
  ctx.stroke();
  ctx.setLineDash([]);
}
function box(x,y,w,h,color,r=5) {
  ctx.beginPath();
  ctx.roundRect(x,y,w,h,r);
  ctx.fillStyle=color;
  ctx.fill();
}
function label(txt,x,y,{size=12,color='#4d655d',bold=false,align='left'} = {}) {
  ctx.font = (bold ? 'bold ' : '') + size + 'px Segoe UI, Arial';
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(txt,x,y);
}
function drawMap(item) {
  box(0,0,870,524,'#edf0e9',0);
  box(21,99,164,126,'#dbe9d3',13);
  box(262,390,230,115,'#dbe9d3',13);
  box(572,42,115,88,'#dbe9d3',13);
  [[55,125],[95,135],[135,132],[67,192],[131,193],[294,458],[325,440],[440,465],[458,438],[596,72],[649,95]].forEach(([x,y])=>{
    box(x,y,19,19,'#c2d9b6',9);
  });

  const river = [[868,8],[845,103],[851,177],[827,241],[833,300],[802,385],[808,446],[778,526]];
  line(river,'#d0e4e5',45);
  line(river,'#b8dce9',28);
  const streets=[
    [[0,83],[220,83],[374,83],[521,83],[744,83],[870,83]],
    [[0,160],[221,160],[374,160],[521,160],[660,160],[744,160],[870,160]],
    [[0,244],[221,244],[374,244],[521,244],[660,244],[744,244],[870,244]],
    [[0,303],[221,303],[374,303],[521,303],[660,303],[744,303],[870,303]],
    [[0,364],[221,364],[374,364],[521,364],[660,364],[744,364],[870,364]],
    [[0,444],[221,444],[245,475],[521,475],[660,475],[744,444],[870,444]],
    [[100,0],[100,83],[100,244],[100,303],[100,364],[100,524]],
    [[221,0],[221,524]],[[374,0],[374,387]],[[521,0],[521,524]],
    [[660,134],[660,524]],[[744,0],[744,524]]
  ];
  for(const street of streets){line(street,'#d2d8ce',17);line(street,'#fff',13);}
  const buildings=[
    [247,102],[287,106],[331,114],[404,104],[448,104],[480,109],[535,107],
    [250,206],[295,202],[328,194],[401,202],[446,202],[478,193],[552,198],[602,199],
    [120,266],[163,260],[252,267],[304,262],[401,264],[456,269],[551,260],[603,264],[690,266],
    [120,328],[163,324],[251,325],[295,324],[411,324],[465,326],[551,320],[600,331],[681,327],
    [25,393],[61,385],[130,393],[167,392],[541,397],[581,402],[612,391],[683,395],[712,398],
    [43,472],[151,480],[549,491],[599,484],[694,488]
  ];
  buildings.forEach(([x,y],i)=>box(x,y,16+(i%5)*4,12+(i%3)*4,i%4===0?'#d9e4d7':'#e0e6dc',3));
  label('PARQUE DO LAGO',35,208,{size:11,bold:true});
  label('PRAÇA DAS ÁGUAS',281,421,{size:11,bold:true});
  label('RUA DO PARQUE',253,142,{size:10});
  label('AV. DAS ÁGUAS',248,347,{size:10});
  label('CANAL',809,481,{size:10,color:'#3e7789'});
  line(routeA,'#81929b',4,true);line(routeB,'#81929b',4,true);
  if(item.route) {
    const selected = item.route === 'A' ? routeA : routeB;
    line(selected,'#ffffff',13);
    line(selected,blue,8);
  }
  if(item.states[0] === 'BLOQUEADO') {line(aSegment,'#fff',14);line(aSegment,red,9);}
  if(item.states[1] === 'BLOQUEADO') {line(bSegment,'#fff',14);line(bSegment,red,9);}
  if(item.states[0] === 'SENSOR_INDISPONIVEL') line(aSegment,'#b66d07',9,true);
  if(item.states[1] === 'SENSOR_INDISPONIVEL') line(bSegment,'#b66d07',9,true);
  [[448,160,'A'],[448,364,'B']].forEach(([x,y,letter],i)=>{
    box(x-43,y-38,86,23,item.states[i] === 'BLOQUEADO' ? red : '#314955',5);
    label('TRECHO '+letter,x,y-22,{size:10,color:'#fff',bold:true,align:'center'});
  });
  [[130,364,'Origem'],[744,244,'Destino']].forEach(([x,y,name])=>{
    box(x-7,y-7,14,14,'#fff',7);
    box(x-4,y-4,8,8,'#173b42',4);
    box(x-29,y+13,58,22,'#fff',4);
    label(name,x,y+28,{size:11,bold:true,align:'center',color:'#153943'});
  });
  box(802,27,38,44,'#ffffff',8);
  label('N',821,44,{size:12,bold:true,align:'center',color:'#173b42'});
  label('↑',821,63,{size:17,bold:true,align:'center',color:'#173b42'});
  ctx.canvas.setAttribute('aria-label','Mapa fictício. '+item.headline+'. '+item.detail);
}
