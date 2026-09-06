<script setup lang="ts">
const openSidePanel = () => {
  chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
}
</script>

<template>
  <main>
    <h3>Alectra Rate Compare</h3>
    <p>Compare Tiered vs. TOU pricing for your Alectra usage</p>
    <button @click="openSidePanel" class="open-btn">Open Comparison Panel</button>
  </main>
</template>

<style scoped>
main {
  padding: 2rem 1rem;
  text-align: center;
  min-width: 20rem;
  background: #121826;
  color: #f5f7fb;
}

h3 {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
  font-weight: 600;
}

p {
  color: #b6c2d9;
  font-size: 0.85rem;
  margin: 0 0 1.5rem;
}

.open-btn {
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, #42b983 0%, #359970 100%);
  border: none;
  border-radius: 0.375rem;
  color: white;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.9rem;
  transition: opacity 0.2s;
}

.open-btn:hover {
  opacity: 0.9;
}

.open-btn:active {
  opacity: 0.8;
}
</style>
