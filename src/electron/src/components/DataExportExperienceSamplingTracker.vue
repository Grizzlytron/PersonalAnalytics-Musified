<script setup lang="ts">
import { PropType } from 'vue';
import ExperienceSamplingDto from '../../shared/dto/ExperienceSamplingDto';

function formatUtcDateTime(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toISOString();
}

defineProps({
  data: {
    type: Object as PropType<ExperienceSamplingDto[]>,
    default: null,
    required: false
  }
});
</script>
<template>
  <div class="my-5 border border-slate-400 p-2">
    <div class="prose max-w-none">
      <h2>Your Self Reported data</h2>
      <p>
        Your responses to the self-reflection questions will also be shared with the researchers.
        They do <b>not</b> contain any sensitive data.
      </p>
      <p>Here is a sample of your unmodified data:</p>
    </div>
    <div class="max-h-48 overflow-auto">
      <table class="table table-zebra table-pin-rows w-full overflow-auto text-xs">
        <thead class="border-b">
          <tr>
            <th>Question 1</th>
            <th>Response 1</th>
            <th>Question 2</th>
            <th>Response 2</th>
            <th>Scale</th>
            <th>Response Options 1</th>
            <th>Response Options 2</th>
            <th>Skipped</th>
            <th>Prompted At</th>
          </tr>
        </thead>
        <tbody class="">
          <tr v-for="d in data" :key="d.id">
            <td>{{ d.question1 || d.question }}</td>
            <td>{{ d.response1 ?? d.response }}</td>
            <td>{{ d.question2 || d.question }}</td>
            <td>{{ d.response2 ?? d.response }}</td>
            <td>{{ d.scale }}</td>
            <td>{{ d.responseOptions1 || d.responseOptions }}</td>
            <td>{{ d.responseOptions2 || d.responseOptions }}</td>
            <td>{{ d.skipped }}</td>
            <td>{{ formatUtcDateTime(d.promptedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
