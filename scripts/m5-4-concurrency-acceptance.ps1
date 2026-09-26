# M5.4 two-session redemption acceptance check.
# This script is intentionally separate from the rollback-scoped SQL suite:
# two independent sessions need to race on one committed temporary token.
$ErrorActionPreference = 'Stop'
$env:SUPABASE_TELEMETRY_DISABLED = '1'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$primary = [guid]::NewGuid().ToString()
$secondary = [guid]::NewGuid().ToString()
$hash = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')).ToLowerInvariant()

function Invoke-RemoteSql([string] $sql) {
  & npx supabase db query --linked $sql --output-format json
  if ($LASTEXITCODE -ne 0) {
    throw "remote SQL failed with exit code $LASTEXITCODE"
  }
}

$seed = "begin; insert into public.profiles(id, display_name) values ('$primary', 'M5.4 Concurrent Primary'), ('$secondary', 'M5.4 Concurrent Secondary'); insert into public.device_link_tokens(profile_id, token_hash, expires_at) values ('$primary', '$hash', now() + interval '10 minutes'); commit;"
$call = "begin; set local role service_role; select public.redeem_device_link('$secondary', '$hash') as result; commit;"
$cleanup = "begin; delete from public.profiles where id in ('$primary', '$secondary'); commit;"

try {
  Invoke-RemoteSql $seed | Out-Null

  $jobs = @(
    (Start-Job -ScriptBlock {
      param($query, $workingDirectory)
      Set-Location $workingDirectory
      $env:SUPABASE_TELEMETRY_DISABLED = '1'
      npx supabase db query --linked $query --output-format json 2>&1
    } -ArgumentList $call, $repoRoot),
    (Start-Job -ScriptBlock {
      param($query, $workingDirectory)
      Set-Location $workingDirectory
      $env:SUPABASE_TELEMETRY_DISABLED = '1'
      npx supabase db query --linked $query --output-format json 2>&1
    } -ArgumentList $call, $repoRoot)
  )
  $jobs | Wait-Job -Timeout 120 | Out-Null
  $outputs = @($jobs | ForEach-Object { (Receive-Job -Job $_ | Out-String) })
  $successes = @($outputs | Where-Object { $_ -match '"cleaned_count"\s*:\s*0' })
  $usedFailures = @($outputs | Where-Object { $_ -match 'DEVICE_LINK_USED' })
  if ($successes.Count -ne 1 -or $usedFailures.Count -ne 1) {
    throw "expected exactly one success and one DEVICE_LINK_USED failure; outputs: $($outputs -join "`n---`n")"
  }
  [pscustomobject]@{
    primary = $primary
    secondary = $secondary
    winners = $successes.Count
    used_failures = $usedFailures.Count
    result = 'PASS'
  } | ConvertTo-Json -Compress
}
finally {
  if ($jobs) { $jobs | Remove-Job -Force -ErrorAction SilentlyContinue }
  Invoke-RemoteSql $cleanup | Out-Null
  $leftovers = "select count(*) as leftovers from public.profiles where id in ('$primary', '$secondary') or id in (select profile_id from public.device_link_tokens where token_hash = '$hash');"
  $leftoverOutput = Invoke-RemoteSql $leftovers | Out-String
  if ($leftoverOutput -notmatch '"leftovers"\s*:\s*0') {
    throw "M5.4 concurrency fixture residue detected: $leftoverOutput"
  }
}
