using System;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using Microsoft.Web.WebView2.Core;

sealed class ProtectedPlayerBridge : IDisposable
{
    readonly CoreWebView2 view;
    readonly HttpClient client;
    readonly CancellationTokenSource closing = new CancellationTokenSource();
    readonly string baseUrl;
    readonly HashSet<CompletedResponseStream> responses = new HashSet<CompletedResponseStream>();

    public ProtectedPlayerBridge(CoreWebView2 view, string baseUrl)
    {
        this.view = view;
        this.baseUrl = baseUrl;
        client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
        {
            Timeout = TimeSpan.FromSeconds(20)
        };
        view.AddWebResourceRequestedFilter("https://*", CoreWebView2WebResourceContext.All);
        view.WebResourceRequested += Forward;
    }

    async void Forward(object sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        Uri target;
        if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out target)) return;
        if (target.Host == "streamfusion.test") return;
        using (var deferral = args.GetDeferral())
        {
            try
            {
                string route;
                if (target.Host == "gql.twitch.tv" && target.AbsolutePath == "/gql" &&
                    (args.Request.Method == "POST" || args.Request.Method == "OPTIONS"))
                    route = "/token";
                else if (args.Request.Method == "GET" || args.Request.Method == "HEAD" || args.Request.Method == "OPTIONS")
                    route = "/media?url=" + Uri.EscapeDataString(args.Request.Uri);
                else
                {
                    Deny(args, 403);
                    return;
                }

                using (var request = new HttpRequestMessage(new HttpMethod(args.Request.Method), baseUrl + route))
                {
                    string range = args.Request.Headers.Contains("Range")
                        ? args.Request.Headers.GetHeader("Range") : null;
                    if (!String.IsNullOrEmpty(range)) request.Headers.TryAddWithoutValidation("Range", range);
                    if (route == "/token" && args.Request.Method == "POST")
                    {
                        request.Content = new StreamContent(args.Request.Content);
                        request.Content.Headers.TryAddWithoutValidation("Content-Type", "application/json");
                    }
                    using (var upstream = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, closing.Token))
                    {
                        var maxBytes = target.AbsolutePath.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase)
                            ? 2 * 1024 * 1024 : 128 * 1024 * 1024;
                        if (route == "/token") maxBytes = 256 * 1024;
                        if (upstream.Content.Headers.ContentLength > maxBytes) { Deny(args, 502); return; }
                        var content = new MemoryStream();
                        using (var source = await upstream.Content.ReadAsStreamAsync())
                        {
                            var buffer = new byte[64 * 1024];
                            int count;
                            while ((count = await source.ReadAsync(buffer, 0, buffer.Length, closing.Token)) > 0)
                            {
                                if (content.Length + count > maxBytes) { content.Dispose(); Deny(args, 502); return; }
                                content.Write(buffer, 0, count);
                            }
                        }
                        content.Position = 0;
                        string headers = "Access-Control-Allow-Origin: https://streamfusion.test\r\n";
                        foreach (var header in upstream.Headers)
                        {
                            if (header.Key.Equals("Access-Control-Allow-Origin", StringComparison.OrdinalIgnoreCase)) continue;
                            foreach (var value in header.Value) headers += header.Key + ": " + value + "\r\n";
                        }
                        foreach (var header in upstream.Content.Headers)
                            foreach (var value in header.Value) headers += header.Key + ": " + value + "\r\n";
                        var completed = new CompletedResponseStream(content.GetBuffer(), (int)content.Length,
                            stream => { lock (responses) responses.Remove(stream); });
                        content.Dispose();
                        lock (responses) responses.Add(completed);
                        args.Response = view.Environment.CreateWebResourceResponse(
                            completed, (int)upstream.StatusCode,
                            upstream.ReasonPhrase ?? "OK", headers);
                    }
                }
            }
            catch
            {
                Deny(args, 502);
            }
        }
    }

    void Deny(CoreWebView2WebResourceRequestedEventArgs args, int status)
    {
        args.Response = view.Environment.CreateWebResourceResponse(
            new MemoryStream(), status, status == 403 ? "Forbidden" : "Bad Gateway",
            "Access-Control-Allow-Origin: https://streamfusion.test\r\nContent-Type: text/plain\r\n");
    }

    public void Dispose()
    {
        closing.Cancel();
        view.WebResourceRequested -= Forward;
        List<CompletedResponseStream> pending;
        lock (responses) pending = new List<CompletedResponseStream>(responses);
        foreach (var response in pending) response.Dispose();
        client.Dispose();
        closing.Dispose();
    }

}
