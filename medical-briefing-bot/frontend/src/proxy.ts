import { NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set('Cache-Control','private, no-store, max-age=0');
  if(process.env.CUSTOMER_AUTH_ENFORCEMENT_ENABLED === 'false')return response;
  const name=process.env.NODE_ENV==='production'?'__Host-medical_customer_session':'medical_customer_session';
  if(request.cookies.get(name)?.value)return response;
  const url=new URL('/login',request.url);url.searchParams.set('next',request.nextUrl.pathname);
  const denied=NextResponse.redirect(url);denied.headers.set('Cache-Control','no-store');return denied;
}
export const config={matcher:['/','/neurology-dashboard']};
