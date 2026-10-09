<script setup lang="ts">
import { computed } from 'vue';
import { DocumentCopy } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
const props = defineProps<{ sql: string }>();
const tokens = computed(() =>
  props.sql
    .split(
      /(--[^\n]*|'(?:''|[^'])*'|`(?:``|[^`])*`|\b(?:ALTER|TABLE|ADD|COLUMN|DROP|CREATE|INDEX|UNIQUE|KEY|PRIMARY|NULL|NOT|DEFAULT|COMMENT|UPDATE|SET|WHERE|INSERT|INTO|VALUES|DELETE|FROM|SELECT|JOIN|ON|USE|ENGINE|CHARSET|VARCHAR|BIGINT|INT|AND|LIMIT|CONVERT|USING)\b)/gi,
    )
    .filter(Boolean)
    .map((text) => ({
      text,
      kind: text.startsWith('--')
        ? 'comment'
        : text.startsWith("'")
          ? 'string'
          : text.startsWith('`')
            ? 'identifier'
            : /^[A-Z]+$/i.test(text)
              ? 'keyword'
              : '',
    })),
);
async function copy() {
  try {
    await navigator.clipboard.writeText(props.sql);
    ElMessage.success('SQL 已复制');
  } catch {
    ElMessage.error('复制失败，请手动选择 SQL');
  }
}
</script>
<template>
  <div class="sql-view">
    <el-button
      class="copy-sql"
      size="small"
      :icon="DocumentCopy"
      @click="copy"
      aria-label="复制 SQL"
      >复制</el-button
    >
    <pre
      tabindex="0"
    ><code><span v-for="(token,i) in tokens" :key="i" :class="token.kind">{{token.text}}</span></code></pre>
  </div>
</template>
