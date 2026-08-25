export function wilsonInterval(successes:number,total:number,z=1.96){
  if(!Number.isFinite(successes)||!Number.isFinite(total)||total<=0||
    successes<0||successes>total)return {lower:0,upper:0};
  const rate=successes/total,z2=z*z,denominator=1+z2/total;
  const center=(rate+z2/(2*total))/denominator;
  const margin=z*Math.sqrt((rate*(1-rate)+z2/(4*total))/total)/denominator;
  return {lower:Math.max(0,center-margin),upper:Math.min(1,center+margin)};
}
