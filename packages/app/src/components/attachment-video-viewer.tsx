import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { VideoView, useVideoPlayer } from "expo-video";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { UploadedFileAttachment } from "@getpaseo/protocol/messages";
import type { AttachmentMetadata } from "@/attachments/types";
import { retainAttachmentForGarbageCollection } from "@/attachments/gc-retention";
import { persistAttachmentFromBytes } from "@/attachments/service";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { acquireUploadedVideoPreview } from "@/attachments/uploaded-video-preview";
import { createAssistantImageAcquisitionCache } from "@/assistant-image/acquisition-cache";
import { isNative, isWeb } from "@/constants/platform";
import { useGlobalWebOverlayLayer, useWebOverlayRegistration } from "@/lib/overlay-root";
import { SPACING, type Theme } from "@/styles/theme";
import { WindowChromeRootRegion } from "@/utils/desktop-window";

const ModalRoot = isNative ? GestureHandlerRootView : View;
const FULLSCREEN_OPTIONS = { enable: true } as const;

export interface AttachmentVideoSource {
  attachment: UploadedFileAttachment;
  client: DaemonClient;
  serverId: string;
}

type PreviewState =
  | { status: "idle" | "loading" }
  | { status: "ready"; metadata: AttachmentMetadata }
  | { status: "failed" };

const previewCache = createAssistantImageAcquisitionCache<AttachmentMetadata>({
  capacity: 20,
  onRetain: (metadata) => retainAttachmentForGarbageCollection(metadata.id),
});

function useUploadedVideoPreview(source: AttachmentVideoSource): {
  status: PreviewState["status"];
  url: string | null;
} {
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const attachment = source.attachment;
  const cacheKey = `${source.serverId}:${attachment.id}:${attachment.path}:${attachment.size}`;

  useEffect(() => {
    let active = true;
    const acquisition = previewCache.acquireRetained(cacheKey, () =>
      acquireUploadedVideoPreview({
        attachment: source.attachment,
        serverId: source.serverId,
        port: {
          readFile: async (cwd, path, maxBytes) =>
            await source.client.readFile(cwd, path, undefined, maxBytes),
          persist: persistAttachmentFromBytes,
        },
      }),
    );

    if (acquisition.value) {
      setState({ status: "ready", metadata: acquisition.value });
    } else {
      setState({ status: "loading" });
      void acquisition.promise.then(
        (metadata) => {
          if (active) setState({ status: "ready", metadata });
          return undefined;
        },
        () => {
          if (active) setState({ status: "failed" });
          return undefined;
        },
      );
    }

    return () => {
      active = false;
      acquisition.release();
    };
  }, [cacheKey, source]);

  const metadata = state.status === "ready" ? state.metadata : null;
  const url = useAttachmentPreviewUrl(metadata);
  return { status: state.status, url };
}

export function AttachmentVideoViewer({
  source,
  onClose,
}: {
  source: AttachmentVideoSource | null;
  onClose: () => void;
}) {
  return source ? <OpenAttachmentVideoViewer source={source} onClose={onClose} /> : null;
}

function OpenAttachmentVideoViewer({
  source,
  onClose,
}: {
  source: AttachmentVideoSource;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const preview = useUploadedVideoPreview(source);
  const player = useVideoPlayer(preview.url);
  const modalLayer = useGlobalWebOverlayLayer("modal", isWeb);
  const handleWebOverlayKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape") return false;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return true;
    },
    [onClose],
  );
  const setWebOverlayScope = useWebOverlayRegistration({
    active: isWeb,
    layer: modalLayer,
    onKeyDown: handleWebOverlayKeyDown,
  });
  const videoStyle = useMemo(
    () => [styles.video, !preview.url && styles.videoHidden],
    [preview.url],
  );
  const closeButtonStyle = useMemo(
    () => [styles.closeButton, { top: insets.top + SPACING[4], right: insets.right + SPACING[4] }],
    [insets.right, insets.top],
  );

  return (
    <Modal transparent animationType="fade" statusBarTranslucent visible onRequestClose={onClose}>
      <ModalRoot style={styles.root}>
        <WindowChromeRootRegion corners="both">
          <View ref={setWebOverlayScope} style={styles.root}>
            <Pressable
              testID="attachment-video-viewer-backdrop"
              accessibilityRole="button"
              accessibilityLabel={t("message.attachments.dismissVideo")}
              onPress={onClose}
              style={styles.backdrop}
            />
            <View pointerEvents="box-none" style={styles.content}>
              {preview.status === "failed" ? (
                <Text style={styles.errorText}>{t("message.attachments.videoLoadFailed")}</Text>
              ) : (
                <View style={styles.videoFrame}>
                  <VideoView
                    testID="attachment-video-viewer"
                    player={player}
                    nativeControls
                    playsInline
                    contentFit="contain"
                    fullscreenOptions={FULLSCREEN_OPTIONS}
                    style={videoStyle}
                  />
                  {!preview.url ? (
                    <Text style={styles.loadingText}>{t("message.attachments.loadingVideo")}</Text>
                  ) : null}
                </View>
              )}
              <Pressable
                testID="attachment-video-viewer-close"
                accessibilityRole="button"
                accessibilityLabel={t("message.attachments.closeVideo")}
                onPress={onClose}
                style={closeButtonStyle}
              >
                <ThemedX size={22} uniProps={foregroundMapping} />
              </Pressable>
            </View>
          </View>
        </WindowChromeRootRegion>
      </ModalRoot>
    </Modal>
  );
}

const ThemedX = withUnistyles(X);
const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.9)",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  videoFrame: {
    width: "100%",
    maxWidth: 960,
    aspectRatio: 16 / 9,
    maxHeight: 640,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  videoHidden: {
    opacity: 0,
  },
  loadingText: {
    position: "absolute",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  closeButton: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
}));
