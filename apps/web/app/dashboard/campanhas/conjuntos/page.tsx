import {MetaLevelPage} from "../level-page";

export const dynamic="force-dynamic";
export default function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  return <MetaLevelPage level="adsets" searchParams={searchParams}/>;
}
