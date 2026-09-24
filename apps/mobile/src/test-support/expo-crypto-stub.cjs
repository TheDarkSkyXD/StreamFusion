exports.getRandomValues = (typedArray) => {
  for (let index = 0; index < typedArray.length; index += 1) {
    typedArray[index] = (index * 17 + 3) % 256;
  }
  return typedArray;
};