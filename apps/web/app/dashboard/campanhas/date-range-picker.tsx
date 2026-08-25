"use client";

import {useState} from "react";

const format=(value:string)=>new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"})
  .format(new Date(`${value}T00:00:00Z`));

export function DateRangePicker({from,to,max}:{from:string;to:string;max:string}){
  const [open,setOpen]=useState(false);
  const [start,setStart]=useState(from);
  const [end,setEnd]=useState(to);
  const preset=(days:number)=>{
    const finish=new Date(`${max}T00:00:00Z`);const begin=new Date(finish);
    begin.setUTCDate(begin.getUTCDate()-days+1);
    setStart(begin.toISOString().slice(0,10));setEnd(max);
  };
  return <div className="date-range-picker">
    <input name="from" type="hidden" value={start}/>
    <input name="to" type="hidden" value={end}/>
    <button className="date-range-trigger" type="button" onClick={()=>setOpen(value=>!value)}
      aria-expanded={open}>▣ {format(start)} – {format(end)}</button>
    {open?<div className="date-range-popover">
      <aside>
        <button type="button" onClick={()=>preset(1)}>Hoje</button>
        <button type="button" onClick={()=>{
          const yesterday=new Date(`${max}T00:00:00Z`);
          yesterday.setUTCDate(yesterday.getUTCDate()-1);
          const value=yesterday.toISOString().slice(0,10);
          setStart(value);setEnd(value);
        }}>Ontem</button>
        <button type="button" onClick={()=>preset(7)}>Últimos 7 dias</button>
        <button type="button" onClick={()=>preset(30)}>Últimos 30 dias</button>
        <button type="button" onClick={()=>{
          const date=new Date(`${max}T00:00:00Z`);
          setStart(`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-01`);
          setEnd(max);
        }}>Este mês</button>
        <span className="active">Personalizado</span>
      </aside>
      <section><h3>Selecionar período</h3><div className="date-range-fields">
        <label>Data inicial<input type="date" value={start} max={end}
          onChange={event=>setStart(event.target.value)}/></label>
        <span>até</span>
        <label>Data final<input type="date" value={end} min={start} max={max}
          onChange={event=>setEnd(event.target.value)}/></label>
      </div><footer><small>Fuso horário: America/Sao_Paulo</small>
        <button type="submit">Atualizar dados</button></footer></section>
    </div>:null}
  </div>;
}
