<script setup lang="ts">
import type { PanelContext } from '@/kernel/public-api';
import CardSquareDialog from '@/modules/deck/CardSquareDialog.vue';

const props = defineProps<{ context: PanelContext }>();

function close(): void {
  void props.context.api.closePanel('card-square');
}
</script>

<template>
  <CardSquareDialog :context="context" @close="close" />
</template>
