import { useState } from "react";
import {
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from "react-native";
import Svg, {
  Defs,
  FeDropShadow,
  Filter,
  G,
  Image,
  LinearGradient,
  Mask,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { gradientStops, paintLayers } from "../domain/paint-rendering";
import type { ChatUsernamePaint } from "../capabilities/chat-interactions";

export function ChatUsername({
  name,
  paint,
  fontSize,
  bold,
  color,
  id,
  style,
}: {
  readonly name: string;
  readonly paint?: ChatUsernamePaint;
  readonly fontSize: number;
  readonly bold: boolean;
  readonly color: string;
  readonly id: string;
  readonly style?: StyleProp<TextStyle>;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const painted = paint !== undefined && size.width > 0;
  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  };
  const fillId = `paint-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const maskId = `${fillId}-mask`;
  const shadow = paint?.shadows[0];
  const weight = bold ? "700" : "500";
  const lineHeight = Math.round(fontSize * 1.4);
  const layers = paint ? paintLayers(paint) : [];
  const glyph = (
    <SvgText
      x={0}
      y={fontSize}
      fontSize={fontSize}
      fontWeight={weight}
      fill="white"
    >
      {name}
    </SvgText>
  );
  return (
    <View style={{ position: "relative" }}>
      <Text
        onLayout={paint ? measure : undefined}
        testID={`watch-chat-username-${id}`}
        style={[
          style,
          { color, fontSize, lineHeight, fontWeight: weight },
          painted && !layers.some((layer) => layer.kind === "image")
            ? { opacity: 0 }
            : null,
          shadow
            ? {
                textShadowColor: shadow.color,
                textShadowOffset: {
                  width: shadow.xOffset,
                  height: shadow.yOffset,
                },
                textShadowRadius: shadow.radius,
              }
            : null,
        ]}
      >
        {name}
      </Text>
      {painted && paint ? (
        <Svg
          pointerEvents="none"
          accessible={false}
          width={size.width}
          height={size.height}
          style={{
            position: "absolute",
            left: 0,
            top: (lineHeight - fontSize) / 2,
          }}
          testID={`watch-chat-paint-${id}`}
        >
          <Defs>
            {paint.shadows.length ? (
              <Filter
                id={fillId + "-shadow"}
                x="-50%"
                y="-100%"
                width="200%"
                height="300%"
              >
                {paint.shadows.map((entry, index) => (
                  <FeDropShadow
                    key={index}
                    in={index ? "shadow-" + (index - 1) : "SourceGraphic"}
                    result={"shadow-" + index}
                    dx={entry.xOffset}
                    dy={entry.yOffset}
                    stdDeviation={entry.radius / 2}
                    floodColor={entry.color}
                  />
                ))}
              </Filter>
            ) : null}
            <Mask id={maskId}>{glyph}</Mask>
            {layers.map((layer, index) => {
              if (layer.kind === "image") return null;
              const gradientId = fillId + "-" + index;
              const stops = gradientStops(layer).map((stop, position) => (
                <Stop key={position} offset={stop.at} stopColor={stop.color} />
              ));
              if (layer.kind === "radial")
                return (
                  <RadialGradient
                    key={gradientId}
                    id={gradientId}
                    cx="50%"
                    cy="50%"
                    rx="50%"
                    ry={layer.shape === "circle" ? size.width / 2 : "50%"}
                  >
                    {stops}
                  </RadialGradient>
                );
              const angle = ((layer.angle ?? 0) * Math.PI) / 180;
              return (
                <LinearGradient
                  key={gradientId}
                  id={gradientId}
                  x1={50 - Math.sin(angle) * 50 + "%"}
                  y1={50 + Math.cos(angle) * 50 + "%"}
                  x2={50 + Math.sin(angle) * 50 + "%"}
                  y2={50 - Math.cos(angle) * 50 + "%"}
                >
                  {stops}
                </LinearGradient>
              );
            })}
          </Defs>
          <G
            {...(paint.shadows.length
              ? { filter: "url(#" + fillId + "-shadow)" }
              : {})}
          >
            <G mask={"url(#" + maskId + ")"}>
              {layers.map((layer, index) =>
                layer.kind === "image" ? (
                  <Image
                    key={index}
                    href={{ uri: layer.imageUrl }}
                    width={size.width}
                    height={size.height}
                    preserveAspectRatio="xMidYMid slice"
                    opacity={layer.opacity}
                  />
                ) : (
                  <Rect
                    key={index}
                    width={size.width}
                    height={size.height}
                    fill={"url(#" + fillId + "-" + index + ")"}
                    opacity={layer.opacity}
                  />
                ),
              )}
            </G>
          </G>
        </Svg>
      ) : null}
    </View>
  );
}
