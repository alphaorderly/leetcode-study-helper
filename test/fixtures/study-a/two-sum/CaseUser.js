export function twoSum(nums, target) {
  const seen = new Map();
  for (const [index, value] of nums.entries()) {
    const complementIndex = seen.get(target - value);
    if (complementIndex !== undefined) {
      return [complementIndex, index];
    }
    seen.set(value, index);
  }
  return [];
}
