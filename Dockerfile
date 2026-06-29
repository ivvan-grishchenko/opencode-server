FROM node:22-slim

# Install Git, GitHub CLI, and other dependencies needed for cloning repos
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    gnupg \
    openssh-client \
    # Install GitHub CLI \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Make the locally installed `opencode` binary available from any working directory
ENV PATH="/app/node_modules/.bin:${PATH}"

# Copy runtime files
COPY start.js opencode.json ./

# Persist OpenCode config, data, snapshots, and cloned repos on this volume
ENV XDG_CONFIG_HOME=/data/config
ENV XDG_DATA_HOME=/data/local
ENV XDG_CACHE_HOME=/data/cache
ENV REPOS_DIR=/data/repos

CMD ["node", "start.js"]
