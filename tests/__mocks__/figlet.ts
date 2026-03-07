const figlet = {
  textSync: jest.fn((text: string) => `ASCII_ART_${text}`),
};
export default figlet;
