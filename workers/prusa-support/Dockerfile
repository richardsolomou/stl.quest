# syntax=docker/dockerfile:1
FROM ubuntu:24.04 AS build
ARG PRUSASLICER_REF=b028299c770b8380ee81c921a2867d522f288123
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    autoconf automake build-essential ca-certificates cmake gettext git libdbus-1-dev libglu1-mesa-dev libgtk-3-dev libtool libwebkit2gtk-4.1-dev texinfo \
    && rm -rf /var/lib/apt/lists/*
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8
WORKDIR /src
RUN git init . \
    && git remote add origin https://github.com/prusa3d/PrusaSlicer.git \
    && git fetch --depth 1 origin "$PRUSASLICER_REF" \
    && git checkout --detach FETCH_HEAD \
    && sed -i 's|URL https://gmplib.org/download/gmp/gmp-6.2.1.tar.bz2|URL https://ftp.gnu.org/gnu/gmp/gmp-6.2.1.tar.bz2 https://gmplib.org/download/gmp/gmp-6.2.1.tar.bz2|' deps/+GMP/GMP.cmake
COPY CMakeLists.txt main.cpp /src/src/printhub-support/
RUN printf '\nadd_subdirectory(printhub-support)\n' >> /src/src/CMakeLists.txt
RUN --mount=type=cache,id=printhub-prusa-deps,target=/src/deps/build \
    cmake -S deps -B deps/build -DCMAKE_BUILD_TYPE=Release \
      -DPrusaSlicer_deps_PACKAGE_EXCLUDES='^(Catch2|NanoSVG|OCCT|OpenCSG|wxWidgets)$' \
    && cmake --build deps/build --parallel 1 \
    && cmake -S . -B build -DSLIC3R_GUI=OFF -DSLIC3R_STATIC=ON -DSLIC3R_PCH=OFF -DSLIC3R_ENABLE_FORMAT_STEP=OFF \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=/src/deps/build/destdir/usr/local \
    && cmake --build build --target printhub-support --parallel 2 \
    && cp build/src/printhub-support/printhub-support /printhub-support

FROM ubuntu:24.04
LABEL org.opencontainers.image.title="PrintHub Prusa support worker" \
      org.opencontainers.image.description="Isolated PrusaSlicer SLA support geometry worker for PrintHub" \
      org.opencontainers.image.source="https://github.com/richardsolomou/printhub" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates libpng16-16t64 python3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /printhub-support /usr/local/bin/printhub-support
COPY server.py /opt/printhub-support/server.py
RUN ! ldd /usr/local/bin/printhub-support | grep -q 'not found'
ENV PORT=8080
EXPOSE 8080
USER 65532:65532
CMD ["python3", "/opt/printhub-support/server.py"]
