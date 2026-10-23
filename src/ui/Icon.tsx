import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { StyleProp, ViewStyle } from 'react-native';

import { ICONS } from './iconPaths';
import type { IconName } from './iconPaths';
import { colors } from './theme';

export type { IconName } from './iconPaths';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** Solid shape instead of a stroke (play, pause, active tab…). */
  filled?: boolean;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export const Icon = React.memo(function Icon({
  name,
  size = 24,
  color = colors.text,
  filled = false,
  strokeWidth = 2,
  style,
}: IconProps) {
  const paint = filled
    ? { fill: color, stroke: 'none' }
    : {
        fill: 'none',
        stroke: color,
        strokeWidth,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
      };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      {ICONS[name].map((shape, index) => {
        switch (shape.kind) {
          case 'circle':
            return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} {...paint} />;
          case 'rect':
            return (
              <Rect
                key={index}
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                rx={shape.rx}
                {...paint}
              />
            );
          default:
            return <Path key={index} d={shape.d} {...paint} />;
        }
      })}
    </Svg>
  );
});
