(function(){
  // Tabs with bare #anchor deep links
  const tabs=[...document.querySelectorAll('.tabs a')];
  function show(id){
    if(!document.getElementById(id)) id='you';
    tabs.forEach(t=>t.setAttribute('aria-selected',String(t.dataset.tab===id)));
    document.querySelectorAll('.tab-panel').forEach(p=>p.hidden=p.id!==id);
  }
  tabs.forEach(t=>t.addEventListener('click',e=>{e.preventDefault();show(t.dataset.tab);try{history.replaceState(null,'','#'+t.dataset.tab)}catch(_){};window.scrollTo({top:0})}));
  show((location.hash||'#you').slice(1));

  // Move steppers
  document.querySelectorAll('.stepper').forEach(fig=>{
    const svgs=JSON.parse(fig.querySelector('script[type="application/json"]').textContent);
    const wrap=fig.querySelector('.board-wrap'), last=svgs.length-1;
    const mvs=[...fig.querySelectorAll('.mv')];
    let i=last;
    function go(n){i=Math.max(0,Math.min(last,n));wrap.innerHTML=svgs[i];mvs.forEach(b=>b.setAttribute('aria-current',String(+b.dataset.ply===i)));}
    fig.querySelectorAll('.nav .btn').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.act;go(a==='first'?0:a==='last'?last:a==='prev'?i-1:i+1)}));
    mvs.forEach(b=>b.addEventListener('click',()=>go(+b.dataset.ply)));
    fig.tabIndex=0;
    fig.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){go(i-1);e.preventDefault()}if(e.key==='ArrowRight'){go(i+1);e.preventDefault()}});
    go(last);
  });

  // Puzzle reveal
  document.querySelectorAll('.puzzle').forEach(p=>{
    const btn=p.querySelector('.reveal');
    btn.addEventListener('click',()=>{
      const open=btn.getAttribute('aria-expanded')!=='true';
      btn.setAttribute('aria-expanded',String(open));
      btn.textContent=open?'Hide the answer':'Show the answer';
      p.querySelector('.answer').hidden=!open;
      p.querySelector('.b-a').hidden=!open;
      p.querySelector('.b-q').hidden=open;
    });
  });
})();
