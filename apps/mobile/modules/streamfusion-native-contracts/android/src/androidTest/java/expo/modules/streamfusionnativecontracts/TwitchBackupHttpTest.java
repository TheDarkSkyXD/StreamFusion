package expo.modules.streamfusionnativecontracts;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.os.StrictMode;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.ConnectionPool;
import okhttp3.EventListener;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.SocketPolicy;
import okhttp3.tls.HandshakeCertificates;
import okhttp3.tls.HeldCertificate;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class TwitchBackupHttpTest {
  @Test public void cancellationEvictsIdleTlsConnectionOffMain() throws Exception {
    withTransport(EventListener.NONE, (server, client, transport, cleanup, requests) -> {
      server.enqueue(new MockResponse().setBody("#EXTM3U\n"));
      String url = server.url("/master.m3u8").toString();
      assertEquals("#EXTM3U\n", requests.submit(() -> transport.text(url)).get(5, TimeUnit.SECONDS));
      assertEquals(1, client.connectionPool().idleConnectionCount());

      cancelOnMain(transport);
      cleanup.submit(() -> {}).get(5, TimeUnit.SECONDS);

      assertEquals(0, client.connectionPool().connectionCount());
      assertNull(requests.submit(() -> transport.text(url)).get(5, TimeUnit.SECONDS));
      assertEquals(1, server.getRequestCount());
      cancelOnMain(transport);
      cleanup.submit(() -> {}).get(5, TimeUnit.SECONDS);
      assertEquals(0, client.connectionPool().connectionCount());
    });
  }

  @Test public void cancellationStopsInflightTlsRequestOffMain() throws Exception {
    withTransport(EventListener.NONE, (server, client, transport, cleanup, requests) -> {
      server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));
      String url = server.url("/blocked.m3u8").toString();
      Future<String> response = requests.submit(() -> transport.text(url));
      assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));

      cancelOnMain(transport);
      cleanup.submit(() -> {}).get(5, TimeUnit.SECONDS);
      assertNull(response.get(5, TimeUnit.SECONDS));
      cleanup.submit(() -> {}).get(5, TimeUnit.SECONDS);

      assertEquals(0, client.connectionPool().connectionCount());
      assertNull(requests.submit(() -> transport.text(url)).get(5, TimeUnit.SECONDS));
      assertEquals(1, server.getRequestCount());
    });
  }

  @Test public void cancellationIncludesCallBeforeNetworkStarts() throws Exception {
    CountDownLatch started = new CountDownLatch(1);
    CountDownLatch proceed = new CountDownLatch(1);
    EventListener listener = new EventListener() {
      @Override public void callStart(Call call) {
        started.countDown();
        try {
          assertTrue(proceed.await(5, TimeUnit.SECONDS));
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
          throw new AssertionError(error);
        }
      }
    };
    withTransport(listener, (server, client, transport, cleanup, requests) -> {
      server.enqueue(new MockResponse().setBody("#EXTM3U\n"));
      String url = server.url("/unstarted.m3u8").toString();
      Future<String> response = requests.submit(() -> transport.text(url));
      try {
        assertTrue(started.await(5, TimeUnit.SECONDS));
        cancelOnMain(transport);
        cleanup.submit(() -> {}).get(5, TimeUnit.SECONDS);
      } finally {
        proceed.countDown();
      }
      assertNull(response.get(5, TimeUnit.SECONDS));
      cleanup.submit(() -> {}).get(5, TimeUnit.SECONDS);
      assertEquals(0, server.getRequestCount());
      assertEquals(0, client.connectionPool().connectionCount());
    });
  }

  private void withTransport(EventListener listener, TestBody test) throws Exception {
    HeldCertificate certificate = new HeldCertificate.Builder()
      .commonName("localhost")
      .addSubjectAlternativeName("localhost")
      .build();
    HandshakeCertificates serverCertificates = new HandshakeCertificates.Builder()
      .heldCertificate(certificate)
      .build();
    HandshakeCertificates clientCertificates = new HandshakeCertificates.Builder()
      .addTrustedCertificate(certificate.certificate())
      .build();
    MockWebServer server = new MockWebServer();
    server.useHttps(serverCertificates.sslSocketFactory(), false);
    server.start();
    ExecutorService cleanup = Executors.newSingleThreadExecutor();
    ExecutorService requests = Executors.newSingleThreadExecutor();
    OkHttpClient client = new OkHttpClient.Builder()
      .sslSocketFactory(clientCertificates.sslSocketFactory(), clientCertificates.trustManager())
      .eventListener(listener)
      .connectionPool(new ConnectionPool(5, 5, TimeUnit.MINUTES))
      .callTimeout(6, TimeUnit.SECONDS)
      .build();
    TwitchBackupHttp transport = new TwitchBackupHttp(client, cleanup);
    try {
      test.run(server, client, transport, cleanup, requests);
    } finally {
      transport.cancel();
      cleanup.submit(() -> {}).get(5, TimeUnit.SECONDS);
      cleanup.shutdownNow();
      requests.shutdownNow();
      server.shutdown();
    }
  }

  private void cancelOnMain(TwitchBackupHttp transport) {
    InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
      StrictMode.ThreadPolicy previous = StrictMode.getThreadPolicy();
      StrictMode.setThreadPolicy(new StrictMode.ThreadPolicy.Builder(previous)
        .detectNetwork().penaltyDeath().build());
      try {
        transport.cancel();
      } finally {
        StrictMode.setThreadPolicy(previous);
      }
    });
  }

  private interface TestBody {
    void run(MockWebServer server, OkHttpClient client, TwitchBackupHttp transport,
      ExecutorService cleanup, ExecutorService requests) throws Exception;
  }
}
