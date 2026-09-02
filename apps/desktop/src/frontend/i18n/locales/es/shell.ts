import type { shellEn } from "../en/shell";
import type { TranslationShape } from "../schema";

export const shellEs = {
  shell: {
    loadingPage: "Cargando página",
    recovery: {
      appTitle: "StreamFusion encontró un problema",
      regionTitle: "{{name}} encontró un problema",
      appDescription: "Recarga la aplicación para restaurar la última página guardada.",
      regionDescription:
        "El resto de la aplicación sigue disponible. Vuelve a intentar esta sección.",
      diagnosticId: "ID de diagnóstico",
      reloadApp: "Recargar aplicación",
      tryAgain: "Intentar de nuevo",
    },
    network: {
      offlineTitle: "Sin conexión a internet",
      offlineDescription: "StreamFusion necesita internet para funcionar.",
      checking: "Comprobando conexión…",
      retryingIn_one: "Reintentando en {{count}} segundo",
      retryingIn_other: "Reintentando en {{count}} segundos",
      checkingStatus: "Comprobando la conexión a internet.",
      offlineStatus:
        "Sin conexión a internet. StreamFusion necesita internet para funcionar y reintentará automáticamente.",
    },
    platformHealth: {
      issues: "Problemas de plataforma",
      twitchOffline: "Twitch sin conexión",
      twitchDegraded: "Twitch degradado",
      kickOffline: "Kick sin conexión",
      kickDegraded: "Kick degradado",
      bothUnreachable: "Kick y Twitch no están disponibles. Reintentando.",
      bothDegraded:
        "Kick y Twitch están degradados. Algunos datos pueden estar en caché o retrasados.",
      twitchUnreachable: "Twitch no está disponible. Reintentando.",
      twitchDegradedMessage: "Twitch está degradado. Puede que algunos canales no carguen.",
      kickUnreachable: "Kick no está disponible. Reintentando.",
      kickDegradedMessage:
        "Kick está degradado. Algunos datos de Kick pueden estar en caché o retrasados.",
    },
    sidebar: {
      collapsedLiveTitle: "{{channel}} (En directo: {{viewers}})",
      connectToSync: "Conecta Twitch o Kick para sincronizar tus seguimientos",
      syncing: "Sincronizando seguimientos",
      syncWith: "Sincronizar seguimientos con {{platforms}}",
      lastSynced: "Última sincronización de {{platform}} a las {{time}}. Sincronizar seguimientos",
      sync: "Sincronizar seguimientos",
      syncFailed: "No se pudieron sincronizar los seguimientos",
      accountMismatch:
        "El sitio web de Kick tiene abierta otra cuenta. Inicia sesión con la misma cuenta de Kick e inténtalo de nuevo. Se conservaron los seguimientos existentes.",
      webSessionRequired:
        "No se completó el inicio de sesión en el sitio web de Kick. Vuelve a intentar sincronizar cuando estés listo. Se conservaron los seguimientos existentes.",
      failedToSync:
        "No se pudieron sincronizar {{platforms}}. Se conservaron los seguimientos existentes.",
      loading: "Cargando canales seguidos",
      retry: "Intentar de nuevo",
      retryTitle: "No se pudieron cargar los seguimientos. Inténtalo de nuevo",
      loadError: "No se pudieron cargar los seguimientos",
      following: "Siguiendo",
      empty: "Sigue canales para verlos aquí",
      stale: "Algunos seguimientos pueden estar desactualizados.",
      showMore: "Mostrar más",
      showLess: "Mostrar menos",
      viewers_one: "{{formattedCount}} espectador",
      viewers_other: "{{formattedCount}} espectadores",
    },
    topNav: {
      expandSidebar: "Expandir barra lateral",
      collapseSidebar: "Contraer barra lateral",
      notifications: "Notificaciones",
      markAllRead: "Marcar todo como leído",
      emptyNotifications: "No hay notificaciones nuevas",
      dismiss: "Descartar",
      clearAll: "Borrar todas las notificaciones",
      liveNow: "está en directo",
      justNow: "Ahora mismo",
      minutesAgo_one: "Hace {{count}} min",
      minutesAgo_other: "Hace {{count}} min",
      hoursAgo_one: "Hace {{count}} hora",
      hoursAgo_other: "Hace {{count}} horas",
      daysAgo_one: "Hace {{count}} día",
      daysAgo_other: "Hace {{count}} días",
    },
    titleBar: {
      minimize: "Minimizar",
      restore: "Restaurar",
      maximize: "Maximizar",
      close: "Cerrar",
    },
  },
} satisfies TranslationShape<typeof shellEn>;
