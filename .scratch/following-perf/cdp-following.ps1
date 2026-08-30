param(
  [ValidateSet("inspect", "navigate", "measure")]
  [string]$Mode = "inspect",
  [int]$Port = 9236,
  [int]$MaxElapsedMs = 0
)

$ErrorActionPreference = "Stop"

function Get-StreamFusionTarget {
  $targets = @(Invoke-RestMethod -Uri "http://localhost:$Port/json/list")
  $target = @(
    $targets | Where-Object {
      $_.type -eq "page" -and
      $_.title -eq "StreamFusion" -and
      $_.url -like "http://localhost:*"
    }
  )[0]
  if (-not $target) {
    throw "No StreamFusion renderer target found on CDP port $Port"
  }
  return $target
}

function Invoke-CdpEvaluation {
  param([string]$Expression)

  $target = Get-StreamFusionTarget
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $cancellation = [Threading.CancellationToken]::None
  try {
    $null = $socket.ConnectAsync(
      [Uri]$target.webSocketDebuggerUrl,
      $cancellation
    ).GetAwaiter().GetResult()
    $message = @{
      id = 1
      method = "Runtime.evaluate"
      params = @{
        expression = $Expression
        awaitPromise = $true
        returnByValue = $true
      }
    } | ConvertTo-Json -Depth 8 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($message)
    $null = $socket.SendAsync(
      [ArraySegment[byte]]::new($bytes),
      [Net.WebSockets.WebSocketMessageType]::Text,
      $true,
      $cancellation
    ).GetAwaiter().GetResult()

    do {
      $stream = [IO.MemoryStream]::new()
      try {
        do {
          $buffer = New-Object byte[] 65536
          $segment = [ArraySegment[byte]]::new($buffer)
          $result = $socket.ReceiveAsync($segment, $cancellation).GetAwaiter().GetResult()
          $stream.Write($buffer, 0, $result.Count)
        } while (-not $result.EndOfMessage)
        $payload = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
      } finally {
        $stream.Dispose()
      }
    } while ($payload.id -ne 1)

    if ($payload.result.exceptionDetails) {
      throw $payload.result.exceptionDetails.text
    }
    return $payload.result.result.value
  } finally {
    $socket.Dispose()
  }
}

if ($Mode -eq "navigate") {
  $result = Invoke-CdpEvaluation @'
(() => {
  const link = [...document.querySelectorAll('a')].find((item) => item.href.endsWith('#/following'));
  if (!link) return JSON.stringify({ ok: false, reason: 'following-link-missing' });
  link.click();
  return JSON.stringify({ ok: true });
})()
'@
  $result | ConvertFrom-Json | ConvertTo-Json -Depth 8
  exit
}

if ($Mode -eq "inspect") {
  $result = Invoke-CdpEvaluation @'
JSON.stringify({
  url: location.href,
  heading: document.querySelector('h1')?.innerText ?? null,
  buttons: [...document.querySelectorAll('button')]
    .map((button, index) => ({
      index,
      text: (button.innerText || '').trim(),
      ariaLabel: button.getAttribute('aria-label'),
      title: button.getAttribute('title'),
      disabled: button.disabled,
    }))
    .filter((button) => button.text || button.ariaLabel || button.title),
})
'@
  $result | ConvertFrom-Json | ConvertTo-Json -Depth 8
  exit
}

$result = Invoke-CdpEvaluation @'
(async () => {
  const candidates = [...document.querySelectorAll('button')].filter((button) =>
    /sync follows|refresh following/i.test(
      [button.getAttribute('aria-label'), button.getAttribute('title'), button.innerText]
        .filter(Boolean)
        .join(' ')
    )
  );
  const pageButton = candidates.find((candidate) =>
    /refresh following/i.test(candidate.getAttribute('aria-label') || candidate.getAttribute('title') || '')
  );
  const button = pageButton ?? candidates.find((candidate) => !candidate.disabled) ?? candidates[0];
  if (!button) return JSON.stringify({ ok: false, reason: 'sync-button-missing', url: location.href });
  const currentButton = () => [...document.querySelectorAll('button')].find((candidate) =>
    /refresh following/i.test(candidate.getAttribute('aria-label') || candidate.getAttribute('title') || '')
  );

  const calls = [];
  const originals = [];
  const hooks = [
    ['auth', 'syncFollows'],
    ['streams', 'getFollowed'],
    ['channels', 'getFollowed'],
    ['categories', 'getTop'],
    ['videos', 'getFollowed'],
    ['clips', 'getFollowed'],
  ];
  for (const [group, method] of hooks) {
    const owner = window.electronAPI?.[group];
    if (!owner || typeof owner[method] !== 'function') continue;
    const original = owner[method];
    originals.push(() => { owner[method] = original; });
    owner[method] = async (...args) => {
      const call = { operation: `${group}.${method}`, args, startMs: performance.now() };
      calls.push(call);
      try {
        const value = await original(...args);
        call.status = 'fulfilled';
        return value;
      } catch (error) {
        call.status = 'rejected';
        call.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        call.endMs = performance.now();
        call.durationMs = call.endMs - call.startMs;
      }
    };
  }

  const startedAt = performance.now();
  try {
    button.click();
    const deadline = startedAt + 180000;
    while (!currentButton()?.disabled && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const becameDisabledAt = performance.now();
    while (currentButton()?.disabled && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const endedAt = performance.now();
    return JSON.stringify({
      ok: !currentButton()?.disabled,
      url: location.href,
      button: {
        ariaLabel: button.getAttribute('aria-label'),
        title: button.getAttribute('title'),
      },
      pendingStateDelayMs: becameDisabledAt - startedAt,
      elapsedMs: endedAt - startedAt,
      calls: calls.map(({ startMs, endMs, ...call }) => ({
        ...call,
        offsetMs: startMs - startedAt,
        durationMs: endMs == null ? null : endMs - startMs,
      })),
    });
  } finally {
    for (const restore of originals.reverse()) restore();
  }
})()
'@
$measurement = $result | ConvertFrom-Json
$measurement | ConvertTo-Json -Depth 12
if ($MaxElapsedMs -gt 0 -and $measurement.elapsedMs -gt $MaxElapsedMs) {
  throw "Manual refresh exceeded ${MaxElapsedMs}ms: $($measurement.elapsedMs)ms"
}
