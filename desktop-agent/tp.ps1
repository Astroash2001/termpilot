# tp: run a coding agent in the TermPilot terminal so the phone can take it over and hand it back,
# the way Happy does it. Loaded into the TermPilot PowerShell by agent.py.
#
#   tp claude [claude options]
#
# Claude starts here under a session id chosen now and written to ~/.termpilot/pc-session.json.
# Tapping Take over on the phone closes Claude here and continues the same session on the phone.
# Pressing Enter here (or Give back on the phone) brings it back with everything said meanwhile.
# The file's "owner" field is the handshake with the PC agent (desktop-agent/acp_host.py).

function tp {
    param([Parameter(Mandatory = $true)][string]$Agent, [Parameter(ValueFromRemainingArguments = $true)]$Rest)
    if ($Agent -ne 'claude') { Write-Host "tp runs: claude"; return }
    $dir = Join-Path $HOME '.termpilot'
    New-Item -ItemType Directory -Force $dir | Out-Null
    $file = Join-Path $dir 'pc-session.json'
    $session = @{ agent = $Agent; sid = [guid]::NewGuid().ToString(); cwd = (Get-Location).Path }
    $read = { try { Get-Content $file -Raw -ErrorAction Stop | ConvertFrom-Json } catch { $null } }
    $save = { param($owner) $session.owner = $owner; $session | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 $file }
    $first = $true
    try {
        while ($true) {
            & $save 'pc'
            if ($first) { claude --session-id $session.sid @Rest; $first = $false }
            else { claude --resume $session.sid }
            # Claude closed. Only the phone asking for it means anything but "done".
            if ((& $read).owner -ne 'phone-wanted') { break }
            & $save 'phone'
            Write-Host ""
            Write-Host "  Claude is on your phone now. Press Enter to bring it back here." -ForegroundColor DarkYellow
            [void][Console]::ReadLine()
            & $save 'pc-request'
            # The phone lets go first, so the session never has two writers
            for ($i = 0; $i -lt 60 -and (& $read).owner -ne 'pc'; $i++) { Start-Sleep -Milliseconds 500 }
        }
    } finally {
        Remove-Item $file -ErrorAction SilentlyContinue
    }
}
