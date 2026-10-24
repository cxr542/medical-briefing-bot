#!/bin/bash
set -euo pipefail

probe_pair() {
  local mode="$1" endpoint="$2" url="$3"
  local common=(--silent --fail --noproxy '*' --http1.1 --proto '=https'
    --connect-timeout 5 --max-time 25 --max-filesize 1048576
    --user-agent 'Mozilla/5.0 (compatible; MedicalBriefingBot/1.0)')
  local metric="{\"mode\":\"$mode\",\"endpoint\":\"$endpoint\",\"http_status\":%{http_code},\"exit_code\":%{exitcode},\"new_connections\":%{num_connects},\"tls_verify_result\":%{ssl_verify_result},\"connect_seconds\":%{time_connect},\"tls_seconds\":%{time_appconnect},\"total_seconds\":%{time_total},\"body_bytes\":%{size_download}}\n"
  local exit_status=0
  if [[ "$mode" == tls12 ]]; then common+=(--tlsv1.2 --tls-max 1.2); fi
  curl --disable "${common[@]}" --output /dev/null --write-out "$metric" "$url" \
    || exit_status=$?
  curl --disable "${common[@]}" --output /dev/null --write-out "$metric" "$url" \
    || exit_status=$?
  printf '{"kind":"pair_exit","mode":"%s","endpoint":"%s","exit_code":%d}\n' \
    "$mode" "$endpoint" "$exit_status"
  return "$exit_status"
}

main() {
  local failures=0
  local listing='https://www.dailymedi.com/news/news_list.php?ca_id=22&page=12'
  local detail='https://www.dailymedi.com/news/news_view.php?ca_id=21&wr_id=941822'
  probe_pair default listing "$listing" || failures=$((failures + 1))
  probe_pair tls12 listing "$listing" || failures=$((failures + 1))
  probe_pair tls12 detail "$detail" || failures=$((failures + 1))
  probe_pair default detail "$detail" || failures=$((failures + 1))
  printf '{"kind":"summary","pairs":4,"planned_transfers":8,"failed_pairs":%d}\n' "$failures"
  return "$((failures > 0))"
}

main
