module.exports = {
  plugins: [
    require('@tailwindcss/postcss'),
    require('postcss-preset-env')({
      stage: 1, // Enable modern CSS features
      features: {
        'nesting-rules': true,
        'custom-properties': true,
        'custom-media-queries': true,
        'media-query-ranges': true,
      },
    }),
    require('postcss-nesting'),
    require('autoprefixer'),
  ],
};
