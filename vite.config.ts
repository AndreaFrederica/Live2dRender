import { defineConfig } from 'vite';
import * as path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main.ts'),
      name: 'Live2dRender',
      fileName: (format) => `live2d-render.${format}.js`,
      formats: ['umd', 'es']
    },
    rollupOptions: {
      output: {
        // 为 UMD 构建提供全局变量名称
        globals: {
          // 如果有外部依赖，在这里定义
        }
      }
    },
    target: 'es2018',
    minify: 'terser',
    sourcemap: false
  },
  resolve: {
    alias: {
      '@framework': path.resolve(__dirname, '../Live2D/CubismSdkForWeb/Framework/src')
    }
  },
  server: {
    port: 5000,
    host: '0.0.0.0',
    open: false,
    fs: {
      // 允许访问项目根目录外的文件
      allow: [
        // 允许访问当前项目目录
        path.resolve(__dirname),
        // 允许访问 Live2D SDK 资源
        path.resolve(__dirname, '../Live2D/CubismSdkForWeb/Samples/Resources')
      ]
    }
  },
  publicDir: false
});
