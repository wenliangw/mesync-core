// vitest.config.ts — 只收 TypeScript 测试
//
// test/ 下还有一份零依赖的 content.test.mjs（用 node --test 跑的），vitest 默认
// 会把 .test.mjs 一起收进来，所以这里显式限定后缀，两套测试各跑各的。

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})