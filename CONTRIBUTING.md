# Contributing

Contributions are welcome. Discuss substantial changes in an issue before investing in them, and keep pull requests focused on the first-release happy path or an agreed issue.

1. Install [mise](https://mise.jdx.dev/) and run `mise trust`, `mise install`, and `mise exec -- npm ci`.
2. Make your change and add offline tests with synthetic fixtures.
3. Run `mise exec -- npm run check`.
4. Describe the change, validation, limitations and any external-service or paid-test requirements in your pull request.

Never commit credentials, real provider responses, private datasets or local checkpoints. Live provider calls must be explicitly authorized by the operator who will incur charges. Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
