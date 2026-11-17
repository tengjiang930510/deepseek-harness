/** Browser integration is opt-in and consumes the checkout's current Web artifacts. */
import { defineConfig } from 'vitest/config'
import base from './vitest.config.ts'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tsy-custom-plugins/t4y-openai-service/tests/ui/**/*.spec.ts'],
    exclude: [],
    maxWorkers: 1,
  },
})
