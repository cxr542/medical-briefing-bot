import { authorizeUser } from '@/lib/customer-auth/general';
import { readArticles } from '@/lib/articlesServer';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const denied=await authorizeUser(request);if(denied)return denied;
  try {return Response.json({articles:await readArticles(new URL(request.url).searchParams)},{headers:{'Cache-Control':'no-store'}});}
  catch(error) {return Response.json({error:'기사를 불러올 수 없습니다.'},{status:error instanceof TypeError?400:503,headers:{'Cache-Control':'no-store'}});}
}
