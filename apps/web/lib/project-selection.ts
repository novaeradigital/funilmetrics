export type ProjectSelection="selected"|"automatic"|"none"|"forbidden";

export function resolveProjectSelection<T extends {id:string}>(projects:T[],selected?:string){
  if(!projects.length)return {project:null,selection:"none" as ProjectSelection};
  if(!selected)return {project:projects[0]!,selection:"automatic" as ProjectSelection};
  const project=projects.find(item=>item.id===selected)??null;
  return {project,selection:(project?"selected":"forbidden") as ProjectSelection};
}
