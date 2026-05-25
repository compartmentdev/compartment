import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class App {
  private static final int heartbeatIntervalSeconds = 5;

  private App() {}

  public static void main(String[] args) throws IOException {
    int port = readPort();
    boolean heartbeatLoggingEnabled = shouldLogHeartbeat();

    System.out.println("java-api-frontend api booting");

    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    ExecutorService executor = Executors.newFixedThreadPool(4);
    ScheduledExecutorService heartbeatExecutor =
        heartbeatLoggingEnabled ? Executors.newSingleThreadScheduledExecutor() : null;

    server.createContext("/ready", exchange -> handleJson(exchange, 200, "{\"service\":\"api\",\"status\":\"ok\"}"));
    server.createContext("/", App::handleDefaultRoute);
    server.setExecutor(executor);
    server.start();
    if (heartbeatExecutor != null) {
      heartbeatExecutor.scheduleAtFixedRate(
          () -> System.out.println("java-api-frontend api heartbeat"),
          heartbeatIntervalSeconds,
          heartbeatIntervalSeconds,
          TimeUnit.SECONDS);
    }

    Runtime.getRuntime()
        .addShutdownHook(
            new Thread(
                () -> {
                  server.stop(0);
                  executor.shutdown();
                  if (heartbeatExecutor != null) {
                    heartbeatExecutor.shutdown();
                  }
                }));

    System.out.println("java-api-frontend api listening on " + port);
  }

  private static void handleDefaultRoute(HttpExchange exchange) throws IOException {
    String path = exchange.getRequestURI().getPath();
    if ("GET".equals(exchange.getRequestMethod()) && "/".equals(path)) {
      handleJson(exchange, 200, "{\"service\":\"api\",\"language\":\"java\"}");
      return;
    }

    handleJson(exchange, 404, "{\"error\":\"not_found\"}");
  }

  private static void handleJson(HttpExchange exchange, int statusCode, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    Headers headers = exchange.getResponseHeaders();
    headers.set("content-type", "application/json; charset=utf-8");
    exchange.sendResponseHeaders(statusCode, bytes.length);
    exchange.getResponseBody().write(bytes);
    exchange.close();
  }

  private static int readPort() {
    String rawPort = System.getenv("PORT");
    if (rawPort == null || rawPort.isBlank()) {
      return 3000;
    }

    return Integer.parseInt(rawPort);
  }

  private static boolean shouldLogHeartbeat() {
    String rawLogLevel = System.getenv("LOG_LEVEL");
    if (rawLogLevel == null) {
      return false;
    }

    return "info".equals(rawLogLevel.trim().toLowerCase(Locale.ROOT));
  }
}
