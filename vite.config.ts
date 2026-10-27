import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: '视频总结 Video Summary',
        namespace: 'video-summary',
        version: '0.1.0',
        description: '在 B站 / YouTube 视频页工具栏添加「视频总结」按钮，获取字幕并通过 OpenAI 兼容接口生成中文总结',
        icon: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text y="20" font-size="20">📝</text></svg>')}`,
        match: ['*://www.bilibili.com/video/*', '*://www.bilibili.com/*/video/*', '*://www.youtube.com/*'],
        noframes: true,
        'run-at': 'document-start',
        connect: ['*'],
      },
      build: {
        fileName: 'video-summary.user.js',
      },
    }),
  ],
});
