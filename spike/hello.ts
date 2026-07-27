function main(): void {
  const nums: number[] = [1, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < nums.length; i++) {
    sum += nums[i];
  }
  console.log(`hello from scriptc, sum=${sum}`);
}

main();
