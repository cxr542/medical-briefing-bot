import 'server-only';
import type { Article } from '@/lib/articleTypes';
import { createAdminSupabaseClient } from '@/lib/adminSupabase';
import { getCollectionCutoffIso, COLLECTION_RUNTIME_SCHEDULE_KST } from '@/lib/collectionStatus';
import { MEDICAL_PRESS_SOURCES, getLastSevenCalendarDaysStartIso } from '@/lib/medicalPress';

export const ARTICLE_FIELDS='id,source,title,url,published_date,status,created_at,category,keywords,keyword_boundary,is_merged,related_links,source_detail_url';
export async function readArticles(params: URLSearchParams, initialSince?: string) {
  const search=(params.get('search')||'').trim();
  if(search.length>200)throw new TypeError('Invalid search');
  let query=createAdminSupabaseClient().from('articles').select('*').neq('status','DELETED').order('published_date',{ascending:false}).limit(500);
  if(initialSince)query=query.gte('published_date',initialSince);
  if(params.get('group')==='medical') {
    const now=new Date();query=query.in('source',[...MEDICAL_PRESS_SOURCES]).lte('published_date',now.toISOString());
    if(params.get('range')==='last-seven-days')query=query.gte('published_date',getLastSevenCalendarDaysStartIso(now));
  } else if(!search) {
    const date=params.get('date')||'',time=params.get('time')||'';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00+09:00'))||!COLLECTION_RUNTIME_SCHEDULE_KST.some(value=>value===time))throw new TypeError('Invalid date');
    query=query.lte('published_date',getCollectionCutoffIso(date,time));
  }
  if(search) {
    // Quoted PostgREST value; escape pattern metacharacters and parser delimiters.
    const pattern='"%'+search.replace(/[\\%_]/g,'\\$&').replaceAll('"','\\"')+'%"';
    query=query.or(['title','category','keywords'].map(field=>`${field}.ilike.${pattern}`).join(','));
  }
  const {data,error}=await query;
  if(error)throw new Error('Article store unavailable');
  return (data||[]).map(row=>Object.fromEntries(ARTICLE_FIELDS.split(',').filter(field=>field in row).map(field=>[field,row[field]])) as unknown as Article);
}
